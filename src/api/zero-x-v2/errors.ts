export abstract class ZeroXAPIError extends Error {
  override readonly name: string;
  readonly description: string;

  constructor({ name, description }: { name: string; description: string }) {
      super(description);
      this.name = name;
      this.description = description;
      Object.setPrototypeOf(this, ZeroXAPIError.prototype);
  }

  public getDescription(): string {
      return this.description;
  }
}
