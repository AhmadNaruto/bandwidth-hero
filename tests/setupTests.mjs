// setupTests.mjs
import { jest } from '@jest/globals';

// Mock the sharp module before it's imported
jest.mock('sharp', () => {
  return jest.fn(() => ({
    metadata: jest.fn(() => Promise.resolve({
      width: 100,
      height: 100,
      format: 'jpeg'
    })),
    resize: jest.fn(() => ({
      grayscale: jest.fn(() => ({
        toFormat: jest.fn(() => ({
          toBuffer: jest.fn(() => Promise.resolve({
            data: Buffer.from('mock-compressed-data'),
            info: { size: 5000, width: 50, height: 50 }
          }))
        }))
      }))
    }))
  }));
});

// Mock the compress function
jest.mock('../util/compress', () => {
  return jest.fn((imagePath, useWebp, grayscale, quality, originalSize) => {
    return Promise.resolve({
      err: null,
      output: Buffer.from('mock-compressed-data'),
      headers: {
        'content-type': useWebp ? 'image/webp' : 'image/jpeg',
        'content-length': 5000,
        'x-original-size': originalSize,
        'x-bytes-saved': originalSize - 5000
      }
    });
  });
});

// Also mock fetch since it's not available in Node environments without it
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: {
      entries: () => [['content-type', 'image/jpeg'], ['content-length', '10000']]
    },
    arrayBuffer: () => Promise.resolve(Buffer.from('mock-image-data'))
  })
);