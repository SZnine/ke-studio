/** Esc and a finished statement stay dismissed until real typing or an explicit request. */
export class CompletionSession {
  dismissed = false;
  revision = 0;
  dismiss() {
    this.dismissed = true;
    this.revision++;
  }
  resume() {
    this.dismissed = false;
    this.revision++;
  }
  typed(text: string) {
    if (!this.dismissed || !/\S/.test(text)) return false;
    this.resume();
    return true;
  }
  accepts(revision: number) {
    return !this.dismissed && revision === this.revision;
  }
}
