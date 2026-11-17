/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  /* The dev-tools badge defaults to the bottom-left corner, which is exactly where the sidebar's
     collapse control sits: it swallowed the click for a developer and for the e2e suite alike
     (shell.spec "the sidebar collapses", 2026-11-17). Every other corner holds a control too.
     Turning the badge off leaves Next's error overlay in place, so a runtime error still shows. */
  devIndicators: false,
};

export default config;
