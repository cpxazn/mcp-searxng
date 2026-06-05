#!/usr/bin/env tsx

/**
 * Unit Tests: search.ts
 * 
 * Tests for SearXNG search functionality
 */

import { strict as assert } from 'node:assert';
import { performWebSearch } from '../../src/search.js';
import { testFunction, createTestResults, printTestSummary } from '../helpers/test-utils.js';
import { createMockServer } from '../helpers/mock-server.js';
import { FetchMocker, createMockFetch, createCapturingMockFetch } from '../helpers/mock-fetch.js';
import { EnvManager } from '../helpers/env-utils.js';

const results = createTestResults();
const fetchMocker = new FetchMocker();
const envManager = new EnvManager();

function makeMockSearchResults(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    title: `Result ${index + 1}`,
    content: `Content ${index + 1}`,
    url: `https://example.com/${index + 1}`,
    score: 1 - index * 0.05,
  }));
}

async function runTests() {
  console.log('🧪 Testing: search.ts\n');

  await testFunction('Error handling for missing SEARXNG_URL', async () => {
    envManager.delete('SEARXNG_URL');
    
    const mockServer = createMockServer();
    
    try {
      await performWebSearch(mockServer as any, 'test query');
      assert.fail('Should have thrown configuration error');
    } catch (error: any) {
      assert.ok(error.message.includes('SEARXNG_URL not configured') || error.message.includes('Configuration'));
    }
    
    envManager.restore();
  }, results);

  await testFunction('Error handling for invalid SEARXNG_URL format', async () => {
    envManager.set('SEARXNG_URL', 'not-a-valid-url');
    
    const mockServer = createMockServer();
    
    try {
      await performWebSearch(mockServer as any, 'test query');
      assert.fail('Should have thrown configuration error for invalid URL');
    } catch (error: any) {
      assert.ok(error.message.includes('Configuration Issues') || error.message.includes('invalid format'));
    }
    
    envManager.restore();
  }, results);

  await testFunction('Parameter validation and URL construction', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_NETWORK_ERROR');
    });

    try {
      await performWebSearch(mockServer as any, 'test query', 2, 'day', 'en', 1);
    } catch (error: any) {
      // Expected to fail with mock error
    }

    // Verify URL construction
    const url = new URL(getCapturedUrl());
    assert.ok(url.pathname.includes('/search'));
    assert.ok(url.searchParams.get('q') === 'test query');
    assert.ok(url.searchParams.get('pageno') === '2');
    assert.ok(url.searchParams.get('time_range') === 'day');
    assert.ok(url.searchParams.get('language') === 'en');
    assert.ok(url.searchParams.get('safesearch') === '1');
    assert.ok(url.searchParams.get('format') === 'json');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('URL construction with subpath', async () => {
    // Case 1: Subpath without trailing slash
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com/subpath');
    
    const mockServer = createMockServer();
    
    // First run
    let capture = createCapturingMockFetch();
    fetchMocker.mock(async (url, options) => {
      await capture.mockFetch(url, options);
      throw new Error('MOCK_NETWORK_ERROR');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch (error: any) {
      // Expected
    }

    let url = new URL(capture.getCapturedUrl());
    assert.ok(url.pathname.includes('/subpath/search'), `Expected path to contain /instance/search, got ${url.pathname}`);
    
    fetchMocker.restore();

    // Case 2: Subpath with trailing slash
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com/subpath/');
    
    // Second run
    capture = createCapturingMockFetch();
    fetchMocker.mock(async (url, options) => {
      await capture.mockFetch(url, options);
      throw new Error('MOCK_NETWORK_ERROR');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch (error: any) {
      // Expected
    }

    url = new URL(capture.getCapturedUrl());
    assert.ok(url.pathname.includes('/subpath/search'), `Expected path to contain /instance/search, got ${url.pathname}`);

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Authentication header construction', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('AUTH_USERNAME', 'testuser');
    envManager.set('AUTH_PASSWORD', 'testpass');
    
    const mockServer = createMockServer();
    const { mockFetch, getCapturedOptions } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_NETWORK_ERROR');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch (error: any) {
      // Expected to fail with mock error
    }

    // Verify auth header was added
    const options = getCapturedOptions();
    assert.ok(options?.headers);
    const headers = options.headers as Record<string, string>;
    assert.ok(headers['Authorization']);
    assert.ok(headers['Authorization'].startsWith('Basic '));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Server error handling with different status codes', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    const statusCodes = [404, 500, 502, 503];
    
    for (const statusCode of statusCodes) {
      const mockFetch = createMockFetch({
        ok: false,
        status: statusCode,
        statusText: `HTTP ${statusCode}`,
        body: `Server error: ${statusCode}`
      });

      fetchMocker.mock(mockFetch);

      try {
        await performWebSearch(mockServer as any, 'test query');
        assert.fail(`Should have thrown server error for status ${statusCode}`);
      } catch (error: any) {
        assert.ok(error.message.includes('Server Error') || error.message.includes(`${statusCode}`));
      }

      fetchMocker.restore();
    }
    
    envManager.restore();
  }, results);

  await testFunction('JSON parsing error handling', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    
    fetchMocker.mock(async () => ({
      ok: true,
      json: async () => {
        throw new Error('Invalid JSON');
      },
      text: async () => 'Invalid JSON response'
    } as any));

    try {
      await performWebSearch(mockServer as any, 'test query');
      assert.fail('Should have thrown JSON parsing error');
    } catch (error: any) {
      assert.ok(error.message.includes('JSON Error') || error.message.includes('Invalid JSON') || error.name === 'MCPSearXNGError');
    }

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Missing results data error handling', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    const mockFetch = createMockFetch({ json: { query: 'test' } });

    fetchMocker.mock(mockFetch);

    try {
      await performWebSearch(mockServer as any, 'test query');
      assert.fail('Should have thrown data error for missing results');
    } catch (error: any) {
      assert.ok(error.message.includes('Data Error') || error.message.includes('results'));
    }

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Empty results handling', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    const mockFetch = createMockFetch({ json: { results: [] } });

    fetchMocker.mock(mockFetch);

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('No results found'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Successful search with results formatting', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    const mockFetch = createMockFetch({
      json: {
        results: [
          {
            title: 'Test Result 1',
            content: 'This is test content 1',
            url: 'https://example.com/1',
            score: 0.95
          },
          {
            title: 'Test Result 2',
            content: 'This is test content 2',
            url: 'https://example.com/2',
            score: 0.87
          }
        ]
      }
    });

    fetchMocker.mock(mockFetch);

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('Test Result 1'));
    assert.ok(result.includes('Test Result 2'));
    assert.ok(result.includes('https://example.com/1'));
    assert.ok(result.includes('https://example.com/2'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('num_results limits formatted results after min_score filtering', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');

    const mockServer = createMockServer();
    const mockFetch = createMockFetch({
      json: {
        results: [
          { title: 'Low Score Result', content: 'Filtered first', url: 'https://example.com/low', score: 0.1 },
          ...makeMockSearchResults(5),
        ]
      }
    });

    fetchMocker.mock(mockFetch);

    const result = await performWebSearch(mockServer as any, 'test query', 1, undefined, 'all', undefined, 0.5, 3);
    assert.ok(!result.includes('Low Score Result'));
    assert.ok(result.includes('Result 1'));
    assert.ok(result.includes('Result 2'));
    assert.ok(result.includes('Result 3'));
    assert.ok(!result.includes('Result 4'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('SEARXNG_MAX_RESULTS caps results when num_results is omitted', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_MAX_RESULTS', '5');

    const mockServer = createMockServer();
    fetchMocker.mock(createMockFetch({ json: { results: makeMockSearchResults(10) } }));

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(result.includes('Result 5'));
    assert.ok(!result.includes('Result 6'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('SEARXNG_MAX_RESULTS is an operator ceiling over num_results', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_MAX_RESULTS', '5');

    const mockServer = createMockServer();
    fetchMocker.mock(createMockFetch({ json: { results: makeMockSearchResults(10) } }));

    const result = await performWebSearch(mockServer as any, 'test query', 1, undefined, 'all', undefined, undefined, 10);
    assert.ok(result.includes('Result 5'));
    assert.ok(!result.includes('Result 6'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Invalid SEARXNG_MAX_RESULTS is ignored', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_MAX_RESULTS', 'not-a-number');

    const mockServer = createMockServer();
    fetchMocker.mock(createMockFetch({ json: { results: makeMockSearchResults(4) } }));

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(result.includes('Result 4'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Omitted num_results and unset SEARXNG_MAX_RESULTS preserves all results', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.delete('SEARXNG_MAX_RESULTS');

    const mockServer = createMockServer();
    fetchMocker.mock(createMockFetch({ json: { results: makeMockSearchResults(6) } }));

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(result.includes('Result 6'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('SEARXNG_MAX_RESULT_CHARS truncates long result content only', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_MAX_RESULT_CHARS', '10');

    const mockServer = createMockServer();
    const mockFetch = createMockFetch({
      json: {
        results: [
          {
            title: 'Long title should stay intact',
            content: 'abcdefghijklmnopqrstuvwxyz',
            url: 'https://example.com/long-url-that-stays-intact',
            score: 1,
          },
        ],
      },
    });
    fetchMocker.mock(mockFetch);

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(result.includes('Title: Long title should stay intact'));
    assert.ok(result.includes('Description: abcdefghij…'));
    assert.ok(result.includes('URL: https://example.com/long-url-that-stays-intact'));
    assert.ok(!result.includes('Description: abcdefghijklmnopqrstuvwxyz'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('SEARXNG_MAX_RESULT_CHARS leaves short content unchanged', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_MAX_RESULT_CHARS', '100');

    const mockServer = createMockServer();
    const mockFetch = createMockFetch({
      json: {
        results: [
          {
            title: 'Short result',
            content: 'short content',
            url: 'https://example.com/short',
            score: 1,
          },
        ],
      },
    });
    fetchMocker.mock(mockFetch);

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(result.includes('Description: short content'));
    assert.ok(!result.includes('short content…'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Invalid SEARXNG_MAX_RESULT_CHARS is ignored', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_MAX_RESULT_CHARS', 'not-a-number');

    const mockServer = createMockServer();
    const mockFetch = createMockFetch({
      json: {
        results: [
          {
            title: 'Untruncated result',
            content: 'abcdefghijklmnopqrstuvwxyz',
            url: 'https://example.com/untruncated',
            score: 1,
          },
        ],
      },
    });
    fetchMocker.mock(mockFetch);

    const result = await performWebSearch(mockServer as any, 'test query');
    assert.ok(result.includes('Description: abcdefghijklmnopqrstuvwxyz'));

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('User-Agent header added when USER_AGENT env var is set', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('USER_AGENT', 'MyCustomBot/1.0');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedOptions } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch {
      // expected
    }

    const options = getCapturedOptions();
    const headers = options?.headers as Record<string, string>;
    assert.ok(headers?.['User-Agent'] === 'MyCustomBot/1.0', `Expected User-Agent header, got: ${JSON.stringify(headers)}`);

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('User-Agent header absent when USER_AGENT env var not set', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.delete('USER_AGENT');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedOptions } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch {
      // expected
    }

    const options = getCapturedOptions();
    const headers = (options?.headers || {}) as Record<string, string>;
    assert.ok(!headers['User-Agent'], `Expected no User-Agent header`);

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('response.text() failure during server error path uses fallback string', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');

    const mockServer = createMockServer();
    fetchMocker.mock(async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => { throw new Error('text() failed'); }
    } as any));

    try {
      await performWebSearch(mockServer as any, 'test query');
      assert.fail('Expected server error');
    } catch (error: any) {
      assert.ok(error.message.includes('500') || error.message.includes('Server Error'));
    }

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('response.text() failure during JSON parse error uses fallback string', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');

    const mockServer = createMockServer();
    fetchMocker.mock(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => { throw new Error('JSON parse failed'); },
      text: async () => { throw new Error('text() also failed'); }
    } as any));

    try {
      await performWebSearch(mockServer as any, 'test query');
      assert.fail('Expected JSON error');
    } catch (error: any) {
      assert.ok(error.name === 'MCPSearXNGError' || error.message.includes('JSON'));
    }

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Proxy dispatcher set when HTTP_PROXY configured', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('HTTP_PROXY', 'http://proxy.example.com:8080');

    const mockServer = createMockServer();
    let capturedOptions: any;
    fetchMocker.mock(async (_url, options) => {
      capturedOptions = options;
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch {
      // expected
    }

    assert.ok(capturedOptions?.dispatcher, 'Expected dispatcher to be set when proxy configured');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('min_score filtering - filters results below threshold', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    fetchMocker.mock(async () => {
      return new Response(JSON.stringify({
        results: [
          { title: 'High score', content: 'Very relevant', url: 'https://high.com', score: 0.9 },
          { title: 'Medium score', content: 'Somewhat relevant', url: 'https://medium.com', score: 0.6 },
          { title: 'Low score', content: 'Not relevant', url: 'https://low.com', score: 0.2 },
          { title: 'Very low score', content: 'Irrelevant', url: 'https://verylow.com', score: 0.05 }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    
    const result = await performWebSearch(mockServer as any, 'test query', 1, undefined, 'all', undefined, 0.5);
    
    // Should only include results with score >= 0.5
    assert.ok(result.includes('High score'), 'Should include high score result');
    assert.ok(result.includes('Medium score'), 'Should include medium score result (0.6 >= 0.5)');
    assert.ok(!result.includes('Low score'), 'Should exclude low score result (0.2 < 0.5)');
    assert.ok(!result.includes('Very low score'), 'Should exclude very low score result (0.05 < 0.5)');
    assert.ok(result.includes('Relevance Score: 0.900'), 'Should include score in output');
    assert.ok(result.includes('Relevance Score: 0.600'), 'Should include score in output');
    
    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('min_score filtering - includes all results when min_score is 0', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    fetchMocker.mock(async () => {
      return new Response(JSON.stringify({
        results: [
          { title: 'Result 1', content: 'Content 1', url: 'https://1.com', score: 0.8 },
          { title: 'Result 2', content: 'Content 2', url: 'https://2.com', score: 0.3 }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    
    const result = await performWebSearch(mockServer as any, 'test query', 1, undefined, 'all', undefined, 0);
    
    // Should include all results when min_score is 0
    assert.ok(result.includes('Result 1'), 'Should include result 1');
    assert.ok(result.includes('Result 2'), 'Should include result 2');
    
    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('min_score filtering - no results when all below threshold', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    fetchMocker.mock(async () => {
      return new Response(JSON.stringify({
        results: [
          { title: 'Low 1', content: 'Low content 1', url: 'https://low1.com', score: 0.1 },
          { title: 'Low 2', content: 'Low content 2', url: 'https://low2.com', score: 0.05 }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    
    const result = await performWebSearch(mockServer as any, 'test query', 1, undefined, 'all', undefined, 0.5);
    
    // Should return no results message when all filtered
    assert.ok(result.includes('No results found') || result.includes('no results'), 'Should indicate no results');
    assert.ok(!result.includes('Low 1'), 'Should not include any low-score results');
    
    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('min_score undefined - no filtering applied', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    
    const mockServer = createMockServer();
    fetchMocker.mock(async () => {
      return new Response(JSON.stringify({
        results: [
          { title: 'High', content: 'High content', url: 'https://high.com', score: 0.9 },
          { title: 'Low', content: 'Low content', url: 'https://low.com', score: 0.1 }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    
    const result = await performWebSearch(mockServer as any, 'test query', 1, undefined, 'all', undefined, undefined);
    
    // Should include all results when min_score is undefined
    assert.ok(result.includes('High'), 'Should include high score result');
    assert.ok(result.includes('Low'), 'Should include low score result');
    
    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('categories="news" adds categories=news to SearXNG request URL', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query', 1, undefined, undefined, undefined, undefined, undefined, 'news');
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('categories'), 'news', 'Expected categories=news in URL');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('categories="it,science" adds categories param to URL', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query', 1, undefined, undefined, undefined, undefined, undefined, 'it,science');
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('categories'), 'it,science', 'Expected categories=it,science in URL');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Omitting categories sends no categories param to SearXNG', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('categories'), null, 'No categories param should be sent when omitted');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('SEARXNG_DEFAULT_LANGUAGE sets language when per-call language is omitted', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_DEFAULT_LANGUAGE', 'fr');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('language'), 'fr', 'Expected language=fr from SEARXNG_DEFAULT_LANGUAGE');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Per-call language overrides SEARXNG_DEFAULT_LANGUAGE', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_DEFAULT_LANGUAGE', 'fr');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query', 1, undefined, 'de');
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('language'), 'de', 'Per-call language should override env default');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('SEARXNG_DEFAULT_SAFESEARCH sets safesearch when per-call safesearch is omitted', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_DEFAULT_SAFESEARCH', '2');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('safesearch'), '2', 'Expected safesearch=2 from SEARXNG_DEFAULT_SAFESEARCH');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Per-call safesearch=0 overrides SEARXNG_DEFAULT_SAFESEARCH=2', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_DEFAULT_SAFESEARCH', '2');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query', 1, undefined, undefined, 0);
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('safesearch'), '0', 'Per-call safesearch=0 should override env default=2');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  await testFunction('Invalid SEARXNG_DEFAULT_SAFESEARCH is silently ignored', async () => {
    envManager.set('SEARXNG_URL', 'https://test-searx.example.com');
    envManager.set('SEARXNG_DEFAULT_SAFESEARCH', 'bad-value');

    const mockServer = createMockServer();
    const { mockFetch, getCapturedUrl } = createCapturingMockFetch();

    fetchMocker.mock(async (url, options) => {
      await mockFetch(url, options);
      throw new Error('MOCK_STOP');
    });

    try {
      await performWebSearch(mockServer as any, 'test query');
    } catch {
      // expected
    }

    const url = new URL(getCapturedUrl());
    assert.equal(url.searchParams.get('safesearch'), null, 'Invalid SEARXNG_DEFAULT_SAFESEARCH should not set URL param');

    fetchMocker.restore();
    envManager.restore();
  }, results);

  printTestSummary(results, 'Search Module');
  return results;
}

// Run if executed directly
import { fileURLToPath } from 'node:url';
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  runTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

export { runTests };
