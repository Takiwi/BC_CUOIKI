import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled exception for ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const isInternalError = !(exception instanceof HttpException);
    const payload =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)
        : undefined;
    const rawMessage = payload?.message;
    const message = isInternalError
      ? 'Internal server error'
      : Array.isArray(rawMessage)
        ? rawMessage.join(', ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : typeof exceptionResponse === 'string'
            ? exceptionResponse
            : 'Request failed';
    const error =
      typeof payload?.error === 'string'
        ? payload.error
        : HttpStatus[statusCode]
            .replaceAll('_', ' ')
            .toLowerCase()
            .replace(/\b\w/g, (character) => character.toUpperCase());

    response.status(statusCode).json({ statusCode, message, error });
  }
}
