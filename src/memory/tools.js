const store = require("./store");
const search = require("./search");
const retriever = require("./retriever");
const logger = require("../logger");

/**
 * Memory tools for explicit memory management
 * These can be registered as tools for the model to use
 */

/**
 * Tool: memory_search
 * Search long-term memories for relevant facts
 */
async function memory_search(args, context = {}) {
  const { query, limit = 10, type, category } = args;

  if (!query || typeof query !== 'string') {
    return {
      ok: false,
      content: JSON.stringify({ error: 'Query parameter is required and must be a string' }),
    };
  }

  try {
    const results = search.searchMemories({
      query,
      limit,
      types: type ? [type] : undefined,
      categories: category ? [category] : undefined,
      sessionId: context.session?.id,
    });

    const formatted = results.map((mem, idx) => ({
      index: idx + 1,
      type: mem.type,
      content: mem.content,
      importance: mem.importance,
      age: retriever.formatAge(Date.now() - mem.createdAt),
      category: mem.category,
    }));

    return {
      ok: true,
      content: JSON.stringify({
        query,
        resultCount: results.length,
        memories: formatted,
      }, null, 2),
      metadata: { resultCount: results.length },
    };
  } catch (err) {
    logger.error({ err, query }, 'Memory search failed');
    return {
      ok: false,
      content: JSON.stringify({ error: 'Memory search failed', message: err.message }),
    };
  }
}

/**
 * Tool: memory_add
 * Manually add a fact to long-term memory
 */
async function memory_add(args, context = {}) {
  const {
    content,
    type = 'fact',
    category = 'general',
    importance = 0.5,
  } = args;

  if (!content || typeof content !== 'string') {
    return {
      ok: false,
      content: JSON.stringify({ error: 'Content parameter is required and must be a string' }),
    };
  }

  if (!['fact', 'preference', 'decision', 'entity', 'relationship'].includes(type)) {
    return {
      ok: false,
      content: JSON.stringify({
        error: 'Invalid type. Must be one of: fact, preference, decision, entity, relationship',
      }),
    };
  }

  if (typeof importance !== 'number' || importance < 0 || importance > 1) {
    return {
      ok: false,
      content: JSON.stringify({ error: 'Importance must be a number between 0 and 1' }),
    };
  }

  try {
    const memory = store.createMemory({
      content,
      type,
      category,
      sessionId: context.session?.id,
      importance,
      surpriseScore: 0.5, // Manual additions get moderate surprise
      metadata: {
        manual: true,
        addedBy: 'user',
        timestamp: Date.now(),
      },
    });

    return {
      ok: true,
      content: JSON.stringify({
        message: 'Memory stored successfully',
        memoryId: memory.id,
        memory: {
          id: memory.id,
          type: memory.type,
          content: memory.content,
          importance: memory.importance,
          category: memory.category,
        },
      }, null, 2),
      metadata: { memoryId: memory.id },
    };
  } catch (err) {
    logger.error({ err, content }, 'Memory add failed');
    return {
      ok: false,
      content: JSON.stringify({ error: 'Failed to add memory', message: err.message }),
    };
  }
}

/**
 * Tool: memory_forget
 * Remove memories matching a query
 */
async function memory_forget(args, context = {}) {
  const { query, confirm = false } = args;

  if (!query || typeof query !== 'string') {
    return {
      ok: false,
      content: JSON.stringify({ error: 'Query parameter is required and must be a string' }),
    };
  }

  try {
    // Search for matching memories
    const matches = search.searchMemories({
      query,
      limit: 50, // Check up to 50 matches
      sessionId: context.session?.id,
    });

    if (matches.length === 0) {
      return {
        ok: true,
        content: JSON.stringify({
          message: 'No memories found matching the query',
          query,
        }),
      };
    }

    if (!confirm) {
      const preview = matches.slice(0, 5).map((mem, idx) => ({
        index: idx + 1,
        type: mem.type,
        content: mem.content.substring(0, 100) + (mem.content.length > 100 ? '...' : ''),
        age: retriever.formatAge(Date.now() - mem.createdAt),
      }));

      return {
        ok: false,
        content: JSON.stringify({
          message: 'Found memories matching query. Set confirm=true to delete them.',
          query,
          matchCount: matches.length,
          preview,
          warning: 'This action cannot be undone',
        }, null, 2),
        metadata: { requiresConfirmation: true, matchCount: matches.length },
      };
    }

    // Delete all matching memories
    let deletedCount = 0;
    for (const memory of matches) {
      const deleted = store.deleteMemory(memory.id);
      if (deleted) deletedCount++;
    }

    return {
      ok: true,
      content: JSON.stringify({
        message: `Deleted ${deletedCount} memories`,
        query,
        deletedCount,
      }, null, 2),
      metadata: { deletedCount },
    };
  } catch (err) {
    logger.error({ err, query }, 'Memory forget failed');
    return {
      ok: false,
      content: JSON.stringify({ error: 'Failed to delete memories', message: err.message }),
    };
  }
}

/**
 * Tool: memory_stats
 * Get statistics about stored memories
 */
async function memory_stats(args, context = {}) {
  try {
    const stats = retriever.getMemoryStats(context.session?.id);

    if (!stats) {
      return {
        ok: false,
        content: JSON.stringify({ error: 'Failed to retrieve memory statistics' }),
      };
    }

    return {
      ok: true,
      content: JSON.stringify({
        total: stats.total,
        byType: stats.byType,
        recentCount: stats.recentCount,
        importantCount: stats.importantCount,
        sessionId: stats.sessionId || 'global',
      }, null, 2),
    };
  } catch (err) {
    logger.error({ err }, 'Memory stats failed');
    return {
      ok: false,
      content: JSON.stringify({ error: 'Failed to get statistics', message: err.message }),
    };
  }
}

// Tool definitions for registration
const MEMORY_TOOLS = {
  memory_search: {
    name: 'memory_search',
    description: 'Search long-term memories for relevant facts and information from previous conversations',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find relevant memories',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return (default: 10)',
          minimum: 1,
          maximum: 50,
        },
        type: {
          type: 'string',
          description: 'Filter by memory type',
          enum: ['fact', 'preference', 'decision', 'entity', 'relationship'],
        },
        category: {
          type: 'string',
          description: 'Filter by category (code, user, project, general)',
        },
      },
      required: ['query'],
    },
    handler: memory_search,
  },

  memory_add: {
    name: 'memory_add',
    description: 'Manually add a fact or piece of information to long-term memory',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The fact or information to remember',
        },
        type: {
          type: 'string',
          description: 'Type of memory',
          enum: ['fact', 'preference', 'decision', 'entity', 'relationship'],
        },
        category: {
          type: 'string',
          description: 'Category: code, user, project, or general',
        },
        importance: {
          type: 'number',
          description: 'Importance score between 0 and 1 (default: 0.5)',
          minimum: 0,
          maximum: 1,
        },
      },
      required: ['content'],
    },
    handler: memory_add,
  },

  memory_forget: {
    name: 'memory_forget',
    description: 'Remove memories matching a search query',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query to match memories to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Set to true to confirm deletion (required for safety)',
        },
      },
      required: ['query'],
    },
    handler: memory_forget,
  },

  memory_stats: {
    name: 'memory_stats',
    description: 'Get statistics about stored memories',
    input_schema: {
      type: 'object',
      properties: {},
    },
    handler: memory_stats,
  },
};

module.exports = {
  memory_search,
  memory_add,
  memory_forget,
  memory_stats,
  MEMORY_TOOLS,
};
