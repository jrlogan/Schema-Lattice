export class PublishError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "PublishError";
  }
}
