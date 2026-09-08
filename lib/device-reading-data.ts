/** Remove only this account's local recovery drafts, never another reader's data. */
export function clearPendingArticleQuestions(storage: Storage, identity?: string): void {
  if (!identity) return;
  const prefix = `edison:pending-question:v1:account:${encodeURIComponent(identity)}:`;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
}
