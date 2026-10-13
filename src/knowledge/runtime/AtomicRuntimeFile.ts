export interface AtomicRuntimeFile {
  initialize(initialContent: string): Promise<void>;

  read(): Promise<string>;

  process(transform: (currentContent: string) => string): Promise<string>;
}
