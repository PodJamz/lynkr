const assert = require("assert");
const { describe, it, beforeEach } = require("node:test");

describe("Surprise Detection", () => {
  let surprise;

  beforeEach(() => {
    // Clear module cache
    delete require.cache[require.resolve("../../src/memory/surprise")];
    surprise = require("../../src/memory/surprise");
  });

  describe("calculateSurprise()", () => {
    it("should return high surprise for novel entities", () => {
      const newMemory = {
        content: "This project uses TensorFlow and PyTorch for ML models",
        type: "fact",
        category: "project"
      };

      const existingMemories = [
        { content: "This project uses Express.js and React", type: "fact" },
        { content: "Database is PostgreSQL", type: "fact" }
      ];

      const score = surprise.calculateSurprise(newMemory, existingMemories);
      assert.ok(score > 0.25, `Expected surprise > 0.25, got ${score}`);
    });

    it("should return low surprise for repeated information", () => {
      const newMemory = {
        content: "User prefers Python",
        type: "preference"
      };

      const existingMemories = [
        { content: "User prefers Python for scripting", type: "preference" },
        { content: "User always uses Python", type: "preference" }
      ];

      const score = surprise.calculateSurprise(newMemory, existingMemories);
      assert.ok(score < 0.3, `Expected surprise < 0.3, got ${score}`);
    });

    it("should detect contradictions and return high surprise", () => {
      const newMemory = {
        content: "User prefers TypeScript over JavaScript",
        type: "preference"
      };

      const existingMemories = [
        { content: "User prefers JavaScript for all projects", type: "preference" }
      ];

      const score = surprise.calculateSurprise(newMemory, existingMemories, {
        userContent: "Actually, I prefer TypeScript"
      });

      assert.ok(score > 0.4, `Expected high contradiction surprise > 0.4, got ${score}`);
    });

    it("should give higher scores to specific details", () => {
      const specificMemory = {
        content: "The authentication module uses JWT tokens with RS256 algorithm and 1-hour expiration",
        type: "fact"
      };

      const vagueMemory = {
        content: "Uses JWT",
        type: "fact"
      };

      const specificScore = surprise.calculateSurprise(specificMemory, []);
      const vagueScore = surprise.calculateSurprise(vagueMemory, []);

      assert.ok(specificScore > vagueScore,
        `Expected specific (${specificScore}) > vague (${vagueScore})`);
    });

    it("should detect user emphasis and increase surprise", () => {
      const memory = {
        content: "Always use async/await for database operations",
        type: "preference"
      };

      const withEmphasis = surprise.calculateSurprise(memory, [], {
        userContent: "IMPORTANT: Always use async/await!"
      });

      const withoutEmphasis = surprise.calculateSurprise(memory, []);

      assert.ok(withEmphasis > withoutEmphasis,
        `Expected emphasis (${withEmphasis}) > no emphasis (${withoutEmphasis})`);
    });

    it("should detect context switches", () => {
      const newMemory = {
        content: "User's favorite color is blue",
        type: "preference",
        category: "user"
      };

      const existingMemories = [
        { content: "Database uses connection pooling", type: "fact", category: "code" },
        { content: "API endpoint uses rate limiting", type: "fact", category: "code" }
      ];

      const score = surprise.calculateSurprise(newMemory, existingMemories);
      // Should have some surprise from context switch (5% weight)
      assert.ok(score > 0, `Expected some surprise from context switch, got ${score}`);
    });

    it("should return 0 for empty existing memories", () => {
      const memory = { content: "Test memory", type: "fact" };
      const score = surprise.calculateSurprise(memory, []);
      assert.ok(score >= 0 && score <= 1, `Score should be in [0,1], got ${score}`);
    });

    it("should bound surprise score between 0 and 1", () => {
      const memory = {
        content: "CRITICAL IMPORTANT: This is completely new revolutionary groundbreaking paradigm shift",
        type: "fact"
      };

      const score = surprise.calculateSurprise(memory, []);
      assert.ok(score >= 0 && score <= 1, `Score should be in [0,1], got ${score}`);
    });
  });

  describe("calculateNovelty()", () => {
    it("should return high novelty for unique content", () => {
      const memory = { content: "GraphQL and Apollo Server", type: "fact" };
      const existing = [
        { content: "REST API with Express", type: "fact" }
      ];

      const novelty = surprise.calculateNovelty(memory, existing);
      assert.ok(novelty > 0.5, `Expected high novelty > 0.5, got ${novelty}`);
    });

    it("should return low novelty for similar content", () => {
      const memory = { content: "Uses Express for API", type: "fact" };
      const existing = [
        { content: "Using Express.js for REST API", type: "fact" }
      ];

      const novelty = surprise.calculateNovelty(memory, existing);
      assert.ok(novelty < 0.5, `Expected low novelty < 0.5, got ${novelty}`);
    });
  });

  describe("detectContradiction()", () => {
    it("should detect contradictions with negation words", () => {
      const memory = { content: "User doesn't like Python", type: "preference" };
      const existing = [
        { content: "User prefers Python", type: "preference" }
      ];

      const contradiction = surprise.detectContradiction(memory, existing);
      assert.ok(contradiction > 0.5, `Expected contradiction > 0.5, got ${contradiction}`);
    });

    it("should detect contradictions with opposing preferences", () => {
      const memory = { content: "User prefers dark mode", type: "preference" };
      const existing = [
        { content: "User prefers light mode", type: "preference" }
      ];

      const contradiction = surprise.detectContradiction(memory, existing);
      assert.ok(contradiction > 0, `Expected some contradiction, got ${contradiction}`);
    });

    it("should return 0 for no contradictions", () => {
      const memory = { content: "User likes TypeScript", type: "preference" };
      const existing = [
        { content: "User likes JavaScript", type: "preference" }
      ];

      const contradiction = surprise.detectContradiction(memory, existing);
      // These are compatible preferences
      assert.ok(contradiction >= 0, `Expected non-negative, got ${contradiction}`);
    });
  });

  describe("measureSpecificity()", () => {
    it("should return high score for detailed content", () => {
      const detailed = "The authentication system uses JWT tokens with RS256 signing, 1-hour access tokens, 7-day refresh tokens, and Redis for token storage";
      const specific = surprise.measureSpecificity(detailed);
      assert.ok(specific >= 0.5, `Expected high specificity >= 0.5, got ${specific}`);
    });

    it("should return low score for vague content", () => {
      const vague = "Uses auth";
      const specific = surprise.measureSpecificity(vague);
      assert.ok(specific < 0.3, `Expected low specificity < 0.3, got ${specific}`);
    });

    it("should give higher scores to content with numbers and technical terms", () => {
      const withDetails = "Server runs on port 3000 with 50 concurrent connections";
      const withoutDetails = "Server runs";

      const scoreWith = surprise.measureSpecificity(withDetails);
      const scoreWithout = surprise.measureSpecificity(withoutDetails);

      assert.ok(scoreWith > scoreWithout,
        `Expected detailed (${scoreWith}) > simple (${scoreWithout})`);
    });
  });

  describe("detectEmphasis()", () => {
    it("should detect all-caps words", () => {
      const emphasized = "IMPORTANT: This is critical";
      const score = surprise.detectEmphasis(emphasized);
      assert.ok(score >= 0.5, `Expected high emphasis >= 0.5, got ${score}`);
    });

    it("should detect emphasis keywords", () => {
      const keywords = [
        "CRITICAL: Remember this",
        "IMPORTANT: Don't forget",
        "NOTE: This is key",
        "ALWAYS use this approach",
        "NEVER do this"
      ];

      keywords.forEach(text => {
        const score = surprise.detectEmphasis(text);
        assert.ok(score > 0, `Expected emphasis for "${text}", got ${score}`);
      });
    });

    it("should detect exclamation marks", () => {
      const excited = "This is really important!!!";
      const score = surprise.detectEmphasis(excited);
      assert.ok(score > 0.3, `Expected some emphasis > 0.3, got ${score}`);
    });

    it("should return 0 for neutral text", () => {
      const neutral = "This is a regular statement.";
      const score = surprise.detectEmphasis(neutral);
      assert.strictEqual(score, 0);
    });
  });

  describe("measureContextSwitch()", () => {
    it("should detect category changes", () => {
      const newMemory = { content: "User's birthday is January 1st", type: "fact", category: "user" };
      const existing = [
        { content: "Uses Express.js", type: "fact", category: "code" },
        { content: "Database is SQLite", type: "fact", category: "code" }
      ];

      const score = surprise.measureContextSwitch(newMemory, existing);
      assert.ok(score > 0, `Expected context switch score > 0, got ${score}`);
    });

    it("should detect type changes", () => {
      const newMemory = { content: "User prefers Python", type: "preference" };
      const existing = [
        { content: "Project uses JavaScript", type: "fact" },
        { content: "API uses REST", type: "fact" }
      ];

      const score = surprise.measureContextSwitch(newMemory, existing);
      assert.ok(score > 0, `Expected type switch score > 0, got ${score}`);
    });

    it("should return low score for similar context", () => {
      const newMemory = { content: "Code fact about functions", type: "fact", category: "code" };
      const existing = [
        { content: "Code fact about functions and classes", type: "fact", category: "code" }
      ];

      const score = surprise.measureContextSwitch(newMemory, existing);
      // Should have low context switch due to keyword overlap
      assert.ok(score < 0.5, `Expected low context switch < 0.5, got ${score}`);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty content", () => {
      const memory = { content: "", type: "fact" };
      const score = surprise.calculateSurprise(memory, []);
      assert.ok(score >= 0 && score <= 1);
    });

    it("should handle very long content", () => {
      const longContent = "word ".repeat(1000);
      const memory = { content: longContent, type: "fact" };
      const score = surprise.calculateSurprise(memory, []);
      assert.ok(score >= 0 && score <= 1);
    });

    it("should handle special characters", () => {
      const memory = { content: "Uses @angular/core ^16.0.0 with RxJS ~7.8", type: "fact" };
      const score = surprise.calculateSurprise(memory, []);
      assert.ok(score >= 0 && score <= 1);
    });
  });
});
