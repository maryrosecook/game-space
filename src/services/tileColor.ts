const minimumContrastWithWhite = 4.5;
const maxColorAttempts = 64;
const fallbackTileColor = '#1D3557';

function randomIndex(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function relativeLuminanceChannel(value: number): number {
  const normalized = value / 255;
  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatioWithWhite(red: number, green: number, blue: number): number {
  const luminance =
    0.2126 * relativeLuminanceChannel(red) +
    0.7152 * relativeLuminanceChannel(green) +
    0.0722 * relativeLuminanceChannel(blue);
  return (1 + 0.05) / (luminance + 0.05);
}

function toHexColor(red: number, green: number, blue: number): string {
  const toHex = (value: number): string => value.toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

export function createReadableRandomHexColor(): string {
  for (let attempt = 0; attempt < maxColorAttempts; attempt += 1) {
    const red = randomIndex(256);
    const green = randomIndex(256);
    const blue = randomIndex(256);
    if (contrastRatioWithWhite(red, green, blue) >= minimumContrastWithWhite) {
      return toHexColor(red, green, blue);
    }
  }

  return fallbackTileColor;
}
