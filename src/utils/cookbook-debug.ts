import { CookbookDebugger } from '../models/export-models';

export class CookbookDebug {
  private static debug: Optional<CookbookDebugger>;

  static setDebugger(debug: CookbookDebugger) {
    this.debug = debug;
  }

  static log(msg: string) {
    if (this.debug) {
      this.debug.log(msg);
    }
  }

  static error(err: Error, ignoreInTests = false) {
    if (this.debug) {
      this.debug.error(err);
    }
    if (process.env.NODE_ENV === 'test' && !ignoreInTests) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
}
