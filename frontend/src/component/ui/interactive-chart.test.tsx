import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ChartSeries,
  InteractiveChart,
  computeMaxValue,
  describeSeries,
  pickAxisLabels,
} from "./interactive-chart";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

function makeSeries(
  values: number[],
  overrides: Partial<ChartSeries> = {},
): ChartSeries {
  return {
    id: "s1",
    name: "Volume",
    color: "#4FD1C5",
    data: values.map((value, i) => ({ label: `Day ${i + 1}`, value })),
    ...overrides,
  };
}

const format = (value: number) => value.toFixed(2);

describe("computeMaxValue", () => {
  it("returns the largest value across visible series", () => {
    expect(computeMaxValue([makeSeries([1, 9, 4])])).toBe(9);
  });

  it("returns null for no series at all", () => {
    expect(computeMaxValue([])).toBeNull();
  });

  it("returns null when every series is empty", () => {
    expect(computeMaxValue([makeSeries([])])).toBeNull();
  });

  it("returns null for an all-zero series, which cannot be scaled", () => {
    // Dividing bar heights by a max of 0 previously produced `NaN%`.
    expect(computeMaxValue([makeSeries([0, 0])])).toBeNull();
  });

  it("ignores non-finite values rather than propagating them", () => {
    expect(computeMaxValue([makeSeries([1, Number.NaN, 5, Infinity])])).toBe(5);
  });

  it("scales to a single point", () => {
    expect(computeMaxValue([makeSeries([42])])).toBe(42);
  });
});

describe("pickAxisLabels", () => {
  it("returns nothing for an empty series", () => {
    expect(pickAxisLabels([])).toEqual([]);
  });

  it("returns one label for a single point, not the same label three times", () => {
    expect(pickAxisLabels(makeSeries([1]).data)).toEqual(["Day 1"]);
  });

  it("returns both labels for two points", () => {
    expect(pickAxisLabels(makeSeries([1, 2]).data)).toEqual(["Day 1", "Day 2"]);
  });

  it("returns first, middle, and last for a longer series", () => {
    expect(pickAxisLabels(makeSeries([1, 2, 3, 4, 5]).data)).toEqual([
      "Day 1",
      "Day 3",
      "Day 5",
    ]);
  });
});

describe("describeSeries", () => {
  it("says plainly when a series has no data", () => {
    expect(describeSeries(makeSeries([]), format)).toBe("Volume: no data.");
  });

  it("describes a single point without implying a range", () => {
    const text = describeSeries(makeSeries([42]), format);
    expect(text).toContain("a single point");
    expect(text).toContain("42.00");
    expect(text).not.toContain("Ranges from");
  });

  it("reports count, span, range, and latest value", () => {
    const text = describeSeries(makeSeries([1, 9, 4]), format);
    expect(text).toContain("3 points");
    expect(text).toContain("Day 1");
    expect(text).toContain("Day 3");
    expect(text).toContain("1.00");
    expect(text).toContain("9.00");
    expect(text).toContain("ending at 4.00");
  });
});

describe("InteractiveChart", () => {
  it("renders a skeleton and no plot while loading", () => {
    const { container } = render(
      <InteractiveChart series={[makeSeries([1, 2, 3])]} title="Volume" isLoading />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading chart data");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders an empty state instead of bare axes when there is no data", () => {
    render(<InteractiveChart series={[]} title="Volume" />);

    expect(screen.getByText("No data yet")).toBeInTheDocument();
    // The bug: axes drawn over nothing read as "the values are zero".
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("-Infinity")).not.toBeInTheDocument();
  });

  it("treats an all-zero series as empty rather than plotting NaN heights", () => {
    render(<InteractiveChart series={[makeSeries([0, 0, 0])]} title="Volume" />);

    expect(screen.getByText("No data yet")).toBeInTheDocument();
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });

  it("accepts custom empty wording", () => {
    render(
      <InteractiveChart
        series={[]}
        emptyTitle="Nothing traded"
        emptyDescription="This market has no volume yet."
      />,
    );

    expect(screen.getByText("Nothing traded")).toBeInTheDocument();
    expect(screen.getByText("This market has no volume yet.")).toBeInTheDocument();
  });

  it("renders a single-point series without breaking scaling", () => {
    const { container } = render(
      <InteractiveChart series={[makeSeries([42])]} title="Volume" />,
    );

    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByTestId("chart-summary")).toHaveTextContent("a single point");

    // Every bar height must be a real percentage.
    const heights = Array.from(
      container.querySelectorAll<HTMLElement>('[style*="height"]'),
    ).map((el) => el.style.height);
    expect(heights.some((h) => h.includes("NaN") || h.includes("Infinity"))).toBe(false);
  });

  it("exposes a readable summary of the data to screen readers", () => {
    render(<InteractiveChart series={[makeSeries([1, 9, 4])]} title="Volume" />);

    const summary = screen.getByTestId("chart-summary");
    expect(summary).toHaveTextContent("Volume: 3 points");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Volume: 3 points",
    );
  });

  it("keeps the legend reachable when every series is hidden", () => {
    render(<InteractiveChart series={[makeSeries([1, 2, 3])]} title="Volume" />);

    fireEvent.click(screen.getByRole("button", { name: /Volume/ }));

    // Hiding the last series must not swap in the empty state, or there would
    // be no legend left to turn it back on.
    expect(screen.getByRole("button", { name: /Volume/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("All series are hidden");
    expect(screen.queryByText("No data yet")).not.toBeInTheDocument();
  });
});
