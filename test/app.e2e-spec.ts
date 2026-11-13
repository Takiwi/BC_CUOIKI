import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.JWT_SECRET ??= 'test-only-secret-that-is-long-enough-0001';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET) checks database connectivity', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ data: { status: 'ok' } });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});
