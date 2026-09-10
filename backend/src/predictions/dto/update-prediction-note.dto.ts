import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Strip HTML markup from a user-supplied prediction note.
 *
 * Notes are personal free text and are never rendered as markup, so tags carry
 * no meaning here and are removed rather than escaped. Removing them keeps the
 * stored value equal to what the user meant to write, and leaves nothing for a
 * downstream consumer to mis-render.
 *
 * Applied in the service rather than as a `@Transform` decorator: the note
 * route does not enable `transform: true` on its ValidationPipe, so a decorator
 * would silently not run. Sanitising at the write keeps it independent of pipe
 * configuration.
 *
 * @param input - The user-provided note
 * @returns The note with markup removed and surrounding whitespace trimmed
 *
 * @example
 * sanitizeNote('<script>alert(1)</script>hi') // returns 'hi'
 * sanitizeNote('  spaced  ')                  // returns 'spaced'
 */
export function sanitizeNote(input: string): string {
  if (!input) return input;
  return input
    // Drop script and style bodies wholesale. Removing only the tags would
    // leave the code itself sitting in the note as plain text.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Remaining tags, including unclosed ones such as `<img src=x onerror=...`.
    .replace(/<[^>]*>?/g, '')
    .trim();
}

export class UpdatePredictionNoteDto {
  @ApiProperty({
    description: 'Personal note for the prediction',
    example: 'I think this outcome is likely based on recent trends',
    maxLength: 1000,
  })
  @IsString()
  @MaxLength(1000)
  note: string;
}
