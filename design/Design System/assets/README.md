# Lighthouse Design System — assets

- **`mosaic-mark.svg`** — the Lighthouse brand mosaic mark (3×3 rounded squares, the eight brand hues). Recreated from screenshots of the Tes brand; **swap for the official Tes vector when available**. For React use prefer the `MosaicMark` component (scales, adjustable gap/radius); use this SVG file for favicons, og-images and non-React contexts.

No raster imagery is required by the design — the system is white-led with colour carried by the mosaic, accents and data. Icons are thin-line (Lucide-style) and live as inline SVG (see `ui_kits/lighthouse/icons.jsx`), not as files here.
