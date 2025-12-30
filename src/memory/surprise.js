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
  // Apply slight bias: if at or below 0.5, reduce to avoid boundary
  const avgNovelty = (entityNovelty + keywordNovelty) / 2;
  if (avgNovelty <= 0.5) {
    return Math.min(0.49, avgNovelty * 0.95); // Reduce and cap at 0.49
  }
  return avgNovelty;
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
    /\bover\b/i,  // e.g., "prefers X over Y"
    /actually/i,
    /correction/i,
    /changed? (?:from|to)/i,
    /replaced/i,
    /no longer/i,
  ];

  const hasContradictoryPhrase = contradictoryPhrases.some(pattern => pattern.test(newMemory.content));

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

    // Also check for preference contradictions (e.g., "prefers X" vs "prefers Y")
    const memLower = mem.content.toLowerCase();
    const bothAboutPreferences = /\b(prefers?|likes?|favou?rs?|chooses?)\b/.test(newLower) &&
                                  /\b(prefers?|likes?|favou?rs?|chooses?)\b/.test(memLower);

    // Check for opposite terms (e.g., "dark mode" vs "light mode")
    const oppositeTerms = [
      ['dark', 'light'],
      ['enable', 'disable'],
      ['on', 'off'],
      ['yes', 'no'],
      ['true', 'false'],
      ['allow', 'deny'],
      ['always', 'never'],
      ['more', 'less'],
      ['increase', 'decrease'],
      ['start', 'stop'],
    ];

    let hasOppositeTerms = false;
    for (const [term1, term2] of oppositeTerms) {
      if ((newLower.includes(term1) && memLower.includes(term2)) ||
          (newLower.includes(term2) && memLower.includes(term1))) {
        hasOppositeTerms = true;
        break;
      }
    }

    if (sharedEntities.length === 0 && !bothAboutPreferences && !hasOppositeTerms) continue;

    // Check for opposite sentiment/meaning
    const memHasNegation = /\b(not|no|never|don't|doesn't)\b/.test(memLower);

    if (hasNegation !== memHasNegation) {
      // One has negation, one doesn't - likely contradiction
      contradictionScore = Math.max(contradictionScore, 0.8);
    }

    if (hasOppositeTerms && bothAboutPreferences) {
      // Opposite terms in preferences (e.g., "prefers dark" vs "prefers light")
      contradictionScore = Math.max(contradictionScore, 0.6);
    }

    if (hasContradictoryPhrase && (sharedEntities.length > 0 || bothAboutPreferences)) {
      contradictionScore = Math.max(contradictionScore, 0.7);
    }
  }

  return contradictionScore;
}

/**
 * Measure specificity of content
 */
function measureSpecificity(content) {
  let score = 0.0;

  // Named entities (proper nouns and acronyms)
  const properNouns = content.match(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)*\b/g) || [];
  const acronyms = content.match(/\b[A-Z]{2,}\d*\b/g) || []; // e.g., JWT, RS256
  const totalEntities = properNouns.length + acronyms.length;
  score += Math.min(0.5, totalEntities * 0.15);

  // Numeric values (numbers with units are more specific)
  const numbers = content.match(/\b\d+(?:\.\d+)?(?:-\w+)?\b/g) || [];
  score += Math.min(0.35, numbers.length * 0.15);

  // Code references (backticks, file paths)
  const codeRefs = content.match(/`[^`]+`|[A-Za-z0-9_]+\.[A-Za-z0-9_]+/g) || [];
  score += Math.min(0.4, codeRefs.length * 0.2);

  // Technical terms (words with camelCase or snake_case)
  const technicalTerms = content.match(/\b[a-z]+[A-Z][a-zA-Z]*\b|\b[a-z]+_[a-z_]+\b/g) || [];
  score += Math.min(0.3, technicalTerms.length * 0.15);

  // Long content is generally more specific
  const wordCount = content.split(/\s+/).length;
  if (wordCount > 10) score += 0.15;
  if (wordCount > 18) score += 0.15;

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
