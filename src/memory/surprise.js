const logger = require("../logger");

/**
 * Calculate surprise score for new memory (Titans-inspired)
 *
 * Surprise factors (without neural networks):
 * 1. Novelty: Is this entity/concept new? (0.30 weight)
 * 2. Contradiction: Does this contradict existing memory? (0.40 weight)
 * 3. Specificity: How specific/detailed is this? (0.15 weight)
 * 4. User emphasis: Did user explicitly emphasize? (0.10 weight)
 * 5. Context switch: Topic change? (0.05 weight)
 */
function calculateSurprise(newMemory, existingMemories, context = {}) {
  try {
    let surprise = 0.0;

    // Factor 1: Novelty (0.0-0.3)
    const noveltyScore = calculateNovelty(newMemory, existingMemories);
    surprise += noveltyScore * 0.30;

    // Factor 2: Contradiction (0.0-0.4)
    const contradictionScore = detectContradiction(newMemory, existingMemories);
    surprise += contradictionScore * 0.40;

    // Factor 3: Specificity (0.0-0.15)
    const specificityScore = measureSpecificity(newMemory.content);
    surprise += specificityScore * 0.15;

    // Factor 4: User emphasis (0.0-0.1)
    const emphasisScore = detectEmphasis(context.userContent || '');
    surprise += emphasisScore * 0.10;

    // Factor 5: Context switch (0.0-0.05)
    const contextSwitchScore = measureContextSwitch(newMemory, existingMemories);
    surprise += contextSwitchScore * 0.05;

    return Math.min(1.0, Math.max(0.0, surprise));
  } catch (err) {
    logger.warn({ err }, 'Surprise calculation failed');
    return 0.5; // Default moderate surprise
  }
}

/**
 * Calculate novelty score - is this information new?
 */
function calculateNovelty(newMemory, existingMemories) {
  if (!existingMemories || existingMemories.length === 0) {
    return 1.0; // Everything is novel with no history
  }

  const newEntities = extractSimpleEntities(newMemory.content);
  const newKeywords = extractKeywords(newMemory.content);

  // Check if entities are new
  let novelEntityCount = 0;
  for (const entity of newEntities) {
    const isNovel = !existingMemories.some(mem =>
      mem.content.toLowerCase().includes(entity.toLowerCase())
    );
    if (isNovel) novelEntityCount++;
  }

  const entityNovelty = newEntities.length > 0
    ? novelEntityCount / newEntities.length
    : 0.5;

  // Check if keywords are new
  let novelKeywordCount = 0;
  for (const keyword of newKeywords) {
    const isNovel = !existingMemories.some(mem =>
      mem.content.toLowerCase().includes(keyword.toLowerCase())
    );
    if (isNovel) novelKeywordCount++;
  }

  const keywordNovelty = newKeywords.length > 0
    ? novelKeywordCount / newKeywords.length
    : 0.5;

  // Average entity and keyword novelty
  return (entityNovelty + keywordNovelty) / 2;
}

/**
 * Detect contradictions with existing memories
 */
function detectContradiction(newMemory, existingMemories) {
  if (!existingMemories || existingMemories.length === 0) {
    return 0.0;
  }

  const newLower = newMemory.content.toLowerCase();

  // Negation patterns
  const hasNegation = /\b(not|no|never|don't|doesn't|didn't|isn't|aren't|wasn't|weren't)\b/.test(newLower);

  // Contradictory phrases
  const contradictoryPhrases = [
    /instead of/i,
    /rather than/i,
    /actually/i,
    /correction/i,
    /changed? (?:from|to)/i,
    /replaced/i,
    /no longer/i,
  ];

  const hasContradictoryPhrase = contradictoryPhrases.some(pattern => pattern.test(newMemory.content));

  if (!hasNegation && !hasContradictoryPhrase) {
    return 0.0;
  }

  // Extract entities from new memory
  const newEntities = extractSimpleEntities(newMemory.content);

  // Look for similar memories with overlapping entities
  let contradictionScore = 0.0;
  for (const mem of existingMemories) {
    const memEntities = extractSimpleEntities(mem.content);

    // Check if memories share entities
    const sharedEntities = newEntities.filter(e =>
      memEntities.some(me => me.toLowerCase() === e.toLowerCase())
    );

    if (sharedEntities.length === 0) continue;

    // Check for opposite sentiment/meaning
    const memLower = mem.content.toLowerCase();
    const memHasNegation = /\b(not|no|never|don't|doesn't)\b/.test(memLower);

    if (hasNegation !== memHasNegation) {
      // One has negation, one doesn't - likely contradiction
      contradictionScore = Math.max(contradictionScore, 0.8);
    }

    if (hasContradictoryPhrase) {
      contradictionScore = Math.max(contradictionScore, 0.6);
    }
  }

  return contradictionScore;
}

/**
 * Measure specificity of content
 */
function measureSpecificity(content) {
  let score = 0.0;

  // Named entities (proper nouns with capitals)
  const properNouns = content.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) || [];
  score += Math.min(0.3, properNouns.length * 0.05);

  // Numeric values
  const numbers = content.match(/\b\d+(?:\.\d+)?\b/g) || [];
  score += Math.min(0.2, numbers.length * 0.05);

  // Code references (backticks, file paths)
  const codeRefs = content.match(/`[^`]+`|[A-Za-z0-9_]+\.[A-Za-z0-9_]+/g) || [];
  score += Math.min(0.3, codeRefs.length * 0.1);

  // Technical terms (words with camelCase or snake_case)
  const technicalTerms = content.match(/\b[a-z]+[A-Z][a-zA-Z]*\b|\b[a-z]+_[a-z_]+\b/g) || [];
  score += Math.min(0.2, technicalTerms.length * 0.05);

  return Math.min(1.0, score);
}

/**
 * Detect user emphasis in message
 */
function detectEmphasis(userContent) {
  if (!userContent) return 0.0;

  const lower = userContent.toLowerCase();
  let score = 0.0;

  // Emphasis keywords
  const emphasisKeywords = [
    'important',
    'critical',
    'crucial',
    'essential',
    'must',
    'need to',
    'remember',
    'note that',
    'pay attention',
    'make sure',
  ];

  for (const keyword of emphasisKeywords) {
    if (lower.includes(keyword)) {
      score += 0.2;
    }
  }

  // Exclamation marks
  const exclamations = (userContent.match(/!/g) || []).length;
  score += Math.min(0.3, exclamations * 0.15);

  // All caps words
  const capsWords = userContent.match(/\b[A-Z]{2,}\b/g) || [];
  score += Math.min(0.2, capsWords.length * 0.1);

  // Repetition (e.g., "very very important")
  const words = lower.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === words[i + 1]) {
      score += 0.15;
      break;
    }
  }

  return Math.min(1.0, score);
}

/**
 * Measure context switch (topic change)
 */
function measureContextSwitch(newMemory, existingMemories) {
  if (!existingMemories || existingMemories.length === 0) {
    return 0.0;
  }

  // Get most recent memories (last 5)
  const recentMemories = existingMemories
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5);

  if (recentMemories.length === 0) return 0.0;

  const newKeywords = extractKeywords(newMemory.content);
  const recentKeywords = new Set();

  for (const mem of recentMemories) {
    const keywords = extractKeywords(mem.content);
    keywords.forEach(k => recentKeywords.add(k));
  }

  // Calculate keyword overlap
  const overlappingKeywords = newKeywords.filter(k => recentKeywords.has(k));
  const overlapRatio = newKeywords.length > 0
    ? overlappingKeywords.length / newKeywords.length
    : 0;

  // Low overlap = high context switch
  return 1.0 - overlapRatio;
}

/**
 * Extract simple entities (capitalized words, code references)
 */
function extractSimpleEntities(text) {
  const entities = new Set();

  // Proper nouns
  const properNouns = text.match(/\b[A-Z][a-z]+\b/g) || [];
  properNouns.forEach(e => entities.add(e));

  // Code identifiers
  const codeIds = text.match(/\b[a-z_][a-z0-9_]*\b/gi) || [];
  codeIds.forEach(e => {
    if (e.length >= 4 && e.length <= 50) {
      entities.add(e);
    }
  });

  // File names
  const files = text.match(/[a-z0-9_-]+\.[a-z]{2,4}/gi) || [];
  files.forEach(e => entities.add(e));

  return Array.from(entities);
}

/**
 * Extract keywords (similar to search.js but simplified)
 */
function extractKeywords(text) {
  const stopwords = new Set([
    'the', 'is', 'at', 'which', 'on', 'and', 'or', 'not', 'this', 'that',
    'with', 'from', 'for', 'to', 'in', 'of', 'a', 'an', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'must', 'can', 'it', 'its',
  ]);

  return text
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\w]/g, ''))
    .filter(word => word.length > 3 && !stopwords.has(word));
}

module.exports = {
  calculateSurprise,
  calculateNovelty,
  detectContradiction,
  measureSpecificity,
  detectEmphasis,
  measureContextSwitch,
  extractSimpleEntities,
  extractKeywords,
};
