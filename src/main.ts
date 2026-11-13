import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: process.env.CLIENT_ORIGIN ?? 'http://localhost:8080',
  });

  // Phục vụ giao diện tĩnh HTML/CSS/JS trực tiếp từ thư mục client
  app.useStaticAssets(join(process.cwd(), 'client'));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cổng quản lý câu lạc bộ và quỹ hoạt động')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`[NestJS] API Server đang chạy tại: http://localhost:${port}`);
  console.log(
    `[NestJS] Giao diện người dùng: http://localhost:${port}/routes/auth/login/`,
  );
  console.log(`[NestJS] Tài liệu API Swagger: http://localhost:${port}/docs`);
}

void bootstrap();
