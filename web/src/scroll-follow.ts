export interface ScrollPosition {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** Keep following new comic panels only while the reader is already near the end. */
export function shouldFollowLatest(position: ScrollPosition, threshold = 48): boolean {
  return position.scrollHeight - position.clientHeight - position.scrollTop <= threshold;
}
