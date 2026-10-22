/**
 * FloodFirst logo: the two figures reaching for each other (the supplied artwork, cut out to a transparent PNG from
 * src/assets/logo.jpg). `logoMark()` is the mark alone; `logoHtml()` is the horizontal lockup (mark + wordmark) used
 * in the headers and footer. Sizes are the side of the square the mark sits in, in pixels.
 */
import markUrl from "./assets/logo-mark.png";

const ASPECT = 720 / 502; // width / height of the cut-out mark

export const LOGO_ASPECT = ASPECT;

/** The mark alone, as an accessible image in a square box (the artwork is centred inside it). */
export const logoMark = (size = 36): string =>
  `<img class="logo-mark" src="${markUrl}" alt="FloodFirst logo" width="${size}" height="${size}" decoding="async" />`;

/** Mark + wordmark. The mark is decorative here (the visible name carries the meaning), so it is hidden from screen readers. */
export const logoHtml = (size = 36): string =>
  `<span class="logo"><img class="logo-mark" src="${markUrl}" alt="" aria-hidden="true" width="${size}" height="${size}" decoding="async" /><span class="logo-word">FloodFirst<sup>®</sup></span></span>`;
