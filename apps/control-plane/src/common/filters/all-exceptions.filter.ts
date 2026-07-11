import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Normalizes every error into a single JSON shape so the UI can render readable
 * messages instead of raw status codes. Unexpected (non-HTTP) errors are logged
 * with their stack and reported to the client as a generic 500 (no leakage).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'InternalServerError';
    // Stable machine-readable code the UI maps to a localized message, plus
    // optional interpolation values (e.g. required/actual role).
    let code: string | undefined;
    let meta: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as {
          message?: string | string[];
          error?: string;
          code?: string;
          meta?: Record<string, unknown>;
        };
        message = b.message ?? exception.message;
        error = b.error ?? exception.name;
        code = b.code;
        meta = b.meta;
      }
    } else if (exception instanceof Error) {
      // Unexpected failure — log the full stack, hide details from the client.
      this.logger.error(
        `Unhandled ${req.method} ${req.url}: ${exception.message}`,
        exception.stack,
      );
    }

    res.status(status).json({
      statusCode: status,
      error,
      code,
      meta,
      message,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
