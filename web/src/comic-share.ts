export const COMIC_SUBREDDIT_URL = "https://www.reddit.com/r/webcomicchat_comics/";
export const COMIC_SUBREDDIT_SUBMIT_URL = `${COMIC_SUBREDDIT_URL}submit`;

export function comicShareTitle(comicTitle: string, selectedPanels: number | undefined): string {
  const title = comicTitle.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, 180);
  if (title) return title;
  if (selectedPanels !== undefined) {
    return selectedPanels === 1 ? "A favorite WebComicChat panel" : `${selectedPanels} favorite WebComicChat panels`;
  }
  return "A comic made with WebComicChat";
}

export function comicPngFilename(selected: boolean, at = Date.now()): string {
  return `comic-chat-${selected ? "selection" : "strip"}-${at}.png`;
}

export function pngDataUrlFile(dataUrl: string, filename: string): File {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl);
  if (!match) throw new Error("The comic image could not be prepared for sharing");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], filename, { type: "image/png" });
}

export function redditComicSubmitUrl(title: string): string {
  const url = new URL(COMIC_SUBREDDIT_SUBMIT_URL);
  url.searchParams.set("title", title);
  return url.toString();
}
