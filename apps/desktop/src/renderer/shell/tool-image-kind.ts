/** Keep this classifier small: image parsing and the lightbox are lazy-loaded. */
export function isImagePreviewTool(name: string): boolean {
  return /(?:^|__|[./])(?:browser_screenshot|view_image|describe_image|read_image|image_input)$/i.test(name);
}
