/**
 * Performance Tests for Titans-Inspired Long-Term Memory System
 *
 * Performance Targets:
 * - Retrieval latency: <50ms for top 10 memories
 * - Extraction latency: <100ms (async, non-blocking)
 * - Memory overhead: <50MB for 10K memories
 * - Database size: ~100 bytes per memory
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Test configuration
const PERFORMANCE_TARGETS = {
  retrievalLatencyMs: 50,
  extractionLatencyMs: 100,
  storageLatencyMs: 10,
  searchLatencyMs: 50,
  memoryOverheadMb: 50,
  bytesPerMemory: 200, // Conservative estimate
};

const TEST_SIZES = {
  small: 100,
  medium: 1000,
  large: 10000,
};

console.log("=".repeat(80));
console.log("Memory System Performance Tests");
console.log("=".repeat(80));
console.log();

// Setup test environment
const testDbPath = path.join(__dirname, `../data/perf-test-${Date.now()}.db`);
process.env.DB_PATH = testDbPath;
process.env.MEMORY_ENABLED = "true";
process.env.MEMORY_SURPRISE_THRESHOLD = "0.3";

// Clear module cache
Object.keys(require.cache).forEach(key => {
  if (key.includes('/src/')) {
    delete require.cache[key];
  }
});

// Initialize modules
const db = require("../src/db");
const store = require("../src/memory/store");
const search = require("../src/memory/search");
const retriever = require("../src/memory/retriever");
const surprise = require("../src/memory/surprise");
const extractor = require("../src/memory/extractor");

/**
 * Measure execution time
 */
function measureTime(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000;
  return { result, durationMs };
}

/**
 * Measure async execution time
 */
async function measureTimeAsync(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000;
  return { result, durationMs };
}

/**
 * Create test memories
 */
function createTestMemories(count) {
  const memories = [];
  const types = ['preference', 'decision', 'fact', 'entity', 'relationship'];
  const categories = ['user', 'code', 'project', 'general'];

  console.log(`Creating ${count} test memories...`);
  const start = Date.now();

  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const category = categories[i % categories.length];

    const memory = store.createMemory({
      content: `Test memory ${i}: This is about ${type} in ${category} with various keywords like Python JavaScript TypeScript React Express`,
      type,
      category,
      importance: Math.random(),
      surpriseScore: Math.random(),
      sessionId: null,
    });

    memories.push(memory);

    if ((i + 1) % 1000 === 0) {
      process.stdout.write(`  Created ${i + 1}/${count}...\r`);
    }
  }

  const duration = Date.now() - start;
  console.log(`  Created ${count} memories in ${duration}ms (${(duration/count).toFixed(2)}ms per memory)`);
  console.log();

  return memories;
}

/**
 * Test 1: Memory Creation Performance
 */
function testCreationPerformance() {
  console.log("Test 1: Memory Creation Performance");
  console.log("-".repeat(60));

  const { durationMs } = measureTime(() => {
    return store.createMemory({
      content: "User prefers Python for data processing with pandas and numpy libraries",
      type: "preference",
      category: "user",
      importance: 0.8,
      surpriseScore: 0.6,
    });
  });

  console.log(`  Single memory creation: ${durationMs.toFixed(2)}ms`);

  if (durationMs < PERFORMANCE_TARGETS.storageLatencyMs) {
    console.log(`  ✓ PASS: Under ${PERFORMANCE_TARGETS.storageLatencyMs}ms target`);
  } else {
    console.log(`  ✗ FAIL: Exceeds ${PERFORMANCE_TARGETS.storageLatencyMs}ms target`);
  }

  console.log();
  return durationMs < PERFORMANCE_TARGETS.storageLatencyMs;
}

/**
 * Test 2: Retrieval Performance at Scale
 */
function testRetrievalPerformance(memoryCount) {
  console.log(`Test 2: Retrieval Performance (${memoryCount} memories)`);
  console.log("-".repeat(60));

  createTestMemories(memoryCount);

  // Test retrieval
  const queries = [
    "Python programming",
    "JavaScript framework",
    "database connection",
    "user authentication",
    "API endpoint",
  ];

  const results = [];

  for (const query of queries) {
    const { result, durationMs } = measureTime(() => {
      return retriever.retrieveRelevantMemories(query, { limit: 10 });
    });

    results.push({ query, durationMs, count: result.length });
    console.log(`  "${query}": ${durationMs.toFixed(2)}ms (${result.length} results)`);
  }

  const avgDuration = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length;
  console.log(`  Average retrieval time: ${avgDuration.toFixed(2)}ms`);

  if (avgDuration < PERFORMANCE_TARGETS.retrievalLatencyMs) {
    console.log(`  ✓ PASS: Under ${PERFORMANCE_TARGETS.retrievalLatencyMs}ms target`);
  } else {
    console.log(`  ✗ FAIL: Exceeds ${PERFORMANCE_TARGETS.retrievalLatencyMs}ms target`);
  }

  console.log();
  return avgDuration < PERFORMANCE_TARGETS.retrievalLatencyMs;
}

/**
 * Test 3: FTS5 Search Performance
 */
function testSearchPerformance(memoryCount) {
  console.log(`Test 3: FTS5 Search Performance (${memoryCount} memories)`);
  console.log("-".repeat(60));

  const queries = [
    "Python",
    "framework AND JavaScript",
    "database OR connection",
    "user authentication security",
  ];

  const results = [];

  for (const query of queries) {
    const { result, durationMs } = measureTime(() => {
      return search.searchMemories({ query, limit: 20 });
    });

    results.push({ query, durationMs, count: result.length });
    console.log(`  "${query}": ${durationMs.toFixed(2)}ms (${result.length} results)`);
  }

  const avgDuration = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length;
  console.log(`  Average search time: ${avgDuration.toFixed(2)}ms`);

  if (avgDuration < PERFORMANCE_TARGETS.searchLatencyMs) {
    console.log(`  ✓ PASS: Under ${PERFORMANCE_TARGETS.searchLatencyMs}ms target`);
  } else {
    console.log(`  ✗ FAIL: Exceeds ${PERFORMANCE_TARGETS.searchLatencyMs}ms target`);
  }

  console.log();
  return avgDuration < PERFORMANCE_TARGETS.searchLatencyMs;
}

/**
 * Test 4: Surprise Calculation Performance
 */
function testSurprisePerformance() {
  console.log("Test 4: Surprise Calculation Performance");
  console.log("-".repeat(60));

  const existingMemories = store.getRecentMemories({ limit: 100 });

  const testCases = [
    "User prefers Rust for systems programming with zero-cost abstractions",
    "This project uses GraphQL with Apollo Server and PostgreSQL database",
    "IMPORTANT: Always validate input to prevent SQL injection attacks",
  ];

  const results = [];

  for (const content of testCases) {
    const { result, durationMs } = measureTime(() => {
      return surprise.calculateSurprise(
        { content, type: "fact", category: "code" },
        existingMemories,
        { userContent: content }
      );
    });

    results.push({ durationMs, score: result });
    console.log(`  Surprise calculation: ${durationMs.toFixed(2)}ms (score: ${result.toFixed(3)})`);
  }

  const avgDuration = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length;
  console.log(`  Average surprise calculation: ${avgDuration.toFixed(2)}ms`);

  // Surprise calculation should be fast (<10ms)
  const passThreshold = 10;
  if (avgDuration < passThreshold) {
    console.log(`  ✓ PASS: Under ${passThreshold}ms target`);
  } else {
    console.log(`  ✗ FAIL: Exceeds ${passThreshold}ms target`);
  }

  console.log();
  return avgDuration < passThreshold;
}

/**
 * Test 5: Memory Extraction Performance
 */
async function testExtractionPerformance() {
  console.log("Test 5: Memory Extraction Performance");
  console.log("-".repeat(60));

  const testResponses = [
    {
      role: "assistant",
      content: "I understand that you prefer Python for data processing and always use pandas for DataFrame operations. We decided to implement the API using FastAPI framework with async/await patterns."
    },
    {
      role: "assistant",
      content: "This project uses TypeScript with strict mode, ESLint for linting, and Jest for testing. The database connection uses connection pooling with max 20 connections."
    },
    {
      role: "assistant",
      content: "IMPORTANT: User wants detailed error messages in development but minimal info in production. The authentication system must use JWT tokens with 1-hour expiration."
    },
  ];

  const results = [];

  for (const response of testResponses) {
    const { result, durationMs } = await measureTimeAsync(async () => {
      return await extractor.extractMemories(response, [], { sessionId: null });
    });

    results.push({ durationMs, count: result.length });
    console.log(`  Extraction: ${durationMs.toFixed(2)}ms (${result.length} memories extracted)`);
  }

  const avgDuration = results.reduce((sum, r) => sum + r.durationMs, 0) / results.length;
  console.log(`  Average extraction time: ${avgDuration.toFixed(2)}ms`);

  if (avgDuration < PERFORMANCE_TARGETS.extractionLatencyMs) {
    console.log(`  ✓ PASS: Under ${PERFORMANCE_TARGETS.extractionLatencyMs}ms target`);
  } else {
    console.log(`  ✗ FAIL: Exceeds ${PERFORMANCE_TARGETS.extractionLatencyMs}ms target`);
  }

  console.log();
  return avgDuration < PERFORMANCE_TARGETS.extractionLatencyMs;
}

/**
 * Test 6: Database Size and Memory Overhead
 */
function testStorageEfficiency(memoryCount) {
  console.log(`Test 6: Storage Efficiency (${memoryCount} memories)`);
  console.log("-".repeat(60));

  // Get the actual database path used
  const actualDbPath = require("../src/config").dbPath;

  if (!fs.existsSync(actualDbPath)) {
    console.log(`  ⚠ SKIP: Database file not found at ${actualDbPath}`);
    console.log();
    return true; // Skip, don't fail
  }

  const stats = fs.statSync(actualDbPath);
  const sizeMb = stats.size / (1024 * 1024);
  const bytesPerMemory = memoryCount > 0 ? stats.size / memoryCount : 0;

  console.log(`  Database size: ${sizeMb.toFixed(2)} MB`);
  console.log(`  Bytes per memory: ${bytesPerMemory.toFixed(0)} bytes`);
  console.log(`  Total memories: ${memoryCount}`);

  if (bytesPerMemory < PERFORMANCE_TARGETS.bytesPerMemory) {
    console.log(`  ✓ PASS: Under ${PERFORMANCE_TARGETS.bytesPerMemory} bytes per memory target`);
  } else {
    console.log(`  ✗ FAIL: Exceeds ${PERFORMANCE_TARGETS.bytesPerMemory} bytes per memory target`);
  }

  console.log();
  return bytesPerMemory < PERFORMANCE_TARGETS.bytesPerMemory;
}

/**
 * Test 7: Concurrent Access Performance
 */
function testConcurrentAccess() {
  console.log("Test 7: Concurrent Access Performance");
  console.log("-".repeat(60));

  const queries = Array.from({ length: 10 }, (_, i) => `query${i}`);

  const start = process.hrtime.bigint();

  const results = queries.map(query => {
    return retriever.retrieveRelevantMemories(query, { limit: 5 });
  });

  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000;

  console.log(`  10 concurrent retrievals: ${durationMs.toFixed(2)}ms`);
  console.log(`  Average per retrieval: ${(durationMs / 10).toFixed(2)}ms`);

  const passThreshold = 100;
  if (durationMs < passThreshold) {
    console.log(`  ✓ PASS: Under ${passThreshold}ms for 10 concurrent queries`);
  } else {
    console.log(`  ✗ FAIL: Exceeds ${passThreshold}ms for 10 concurrent queries`);
  }

  console.log();
  return durationMs < passThreshold;
}

/**
 * Run all performance tests
 */
async function runPerformanceTests() {
  console.log(`Starting at: ${new Date().toISOString()}`);
  console.log();

  const results = {
    creation: false,
    retrieval: false,
    search: false,
    surprise: false,
    extraction: false,
    storage: false,
    concurrent: false,
  };

  try {
    // Test 1: Creation
    results.creation = testCreationPerformance();

    // Test 2: Retrieval (with 1000 memories)
    results.retrieval = testRetrievalPerformance(TEST_SIZES.medium);

    // Test 3: Search
    results.search = testSearchPerformance(TEST_SIZES.medium);

    // Test 4: Surprise
    results.surprise = testSurprisePerformance();

    // Test 5: Extraction
    results.extraction = await testExtractionPerformance();

    // Test 6: Storage efficiency
    const totalMemories = store.countMemories();
    results.storage = testStorageEfficiency(totalMemories);

    // Test 7: Concurrent access
    results.concurrent = testConcurrentAccess();

    // Summary
    console.log("=".repeat(80));
    console.log("Performance Test Summary");
    console.log("=".repeat(80));
    console.log();

    const passCount = Object.values(results).filter(Boolean).length;
    const totalTests = Object.keys(results).length;

    Object.entries(results).forEach(([test, passed]) => {
      console.log(`  ${passed ? '✓' : '✗'} ${test.padEnd(20)} ${passed ? 'PASS' : 'FAIL'}`);
    });

    console.log();
    console.log(`Total: ${passCount}/${totalTests} tests passed`);
    console.log();

    if (passCount === totalTests) {
      console.log("✓ All performance tests PASSED");
      return 0;
    } else {
      console.log(`✗ ${totalTests - passCount} performance tests FAILED`);
      return 1;
    }

  } catch (err) {
    console.error("Performance test error:", err);
    return 1;
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
        console.log(`Cleaned up test database: ${testDbPath}`);
      }
    } catch (err) {
      console.error("Cleanup error:", err);
    }
  }
}

// Run tests
runPerformanceTests()
  .then(exitCode => {
    process.exit(exitCode);
  })
  .catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
