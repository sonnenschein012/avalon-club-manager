export class FirestoreDeadlineError extends Error {
  readonly code = 'deadline-exceeded';

  constructor() {
    super('서버 응답 시간이 초과되었습니다. 기록을 확인한 뒤 다시 시도해 주세요.');
  }
}

export async function withFirestoreDeadline<T>(
  action: (signal: AbortSignal) => Promise<T>,
  milliseconds = 20_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new FirestoreDeadlineError();
          controller.abort(error);
          reject(error);
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
