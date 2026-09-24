/** Return selected panel indexes in comic order, regardless of the order they were tapped. */
export function selectedPanelIndexes(
  panelKeys: readonly string[],
  selectedKeys: ReadonlySet<string>,
): number[] {
  const indexes: number[] = [];
  panelKeys.forEach((key, index) => {
    if (selectedKeys.has(key)) indexes.push(index);
  });
  return indexes;
}

/** Remove selections for panels that disappeared or changed during a comic redraw. */
export function reconcilePanelSelection(
  selectedKeys: ReadonlySet<string>,
  availableKeys: readonly string[],
): Set<string> {
  const available = new Set(availableKeys);
  return new Set([...selectedKeys].filter((key) => available.has(key)));
}
