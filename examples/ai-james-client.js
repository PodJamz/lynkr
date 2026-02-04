/**
 * AI James Remote Client for Lynkr
 *
 * Example client for AI James to call Lynkr remotely through Cloudflare Tunnel.
 * This provides Claude Code-like capabilities to remote AI agents.
 *
 * Usage:
 *   const client = new LynkrRemoteClient(
 *     'https://your-tunnel.trycloudflare.com',
 *     'your-api-key'
 *   );
 *
 *   // Send a message with tool execution
 *   const stream = await client.sendMessage({
 *     prompt: 'List files in current directory',
 *     cwd: '/Users/jamesspalding/projects/myproject',
 *     sessionId: 'ai-james-session-1'
 *   });
 */

class LynkrRemoteClient {
  constructor(tunnelUrl, apiKey) {
    this.baseUrl = tunnelUrl.replace(/\/+$/, ""); // Remove trailing slashes
    this.apiKey = apiKey;
  }

  /**
   * Send a message to Lynkr with optional tool execution
   *
   * @param {Object} options
   * @param {string} options.prompt - The user prompt to send
   * @param {string} options.cwd - Working directory for tool execution
   * @param {string} [options.sessionId] - Session ID for conversation continuity
   * @param {string} [options.sessionName] - Human-readable session name
   * @param {string} [options.model] - Model to use (default: claude-sonnet-4-20250514)
   * @param {number} [options.maxTokens] - Max tokens for response (default: 8096)
   * @param {boolean} [options.stream] - Whether to stream response (default: true)
   * @param {Array} [options.messages] - Full messages array (overrides prompt)
   * @returns {Promise<ReadableStream|Object>} SSE stream or JSON response
   */
  async sendMessage(options) {
    const {
      prompt,
      cwd,
      sessionId,
      sessionName,
      model = "claude-sonnet-4-20250514",
      maxTokens = 8096,
      stream = true,
      messages,
    } = options;

    const headers = {
      "Content-Type": "application/json",
      "X-Remote-Access-Key": this.apiKey,
    };

    if (sessionId) {
      headers["X-Session-Id"] = sessionId;
    }
    if (sessionName) {
      headers["X-Session-Name"] = sessionName;
    }
    if (cwd) {
      headers["X-Workspace-Cwd"] = cwd;
    }

    const body = {
      model,
      max_tokens: maxTokens,
      messages: messages || [{ role: "user", content: prompt }],
      stream,
    };

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        error: { message: response.statusText },
      }));
      throw new Error(
        `Lynkr API error: ${error.error?.message || response.statusText}`
      );
    }

    return stream ? response.body : response.json();
  }

  /**
   * List available models
   * @returns {Promise<Object>} Models list
   */
  async listModels() {
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: {
        "X-Remote-Access-Key": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Health check
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    const response = await fetch(`${this.baseUrl}/health/live`);
    return response.ok;
  }

  /**
   * Parse SSE stream and yield events
   * @param {ReadableStream} stream - SSE stream from sendMessage
   * @yields {Object} Parsed SSE events
   */
  async *parseStream(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              return;
            }
            try {
              yield JSON.parse(data);
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Send message and collect full response
   * @param {Object} options - Same as sendMessage
   * @returns {Promise<string>} Full response text
   */
  async sendMessageAndCollect(options) {
    const stream = await this.sendMessage({ ...options, stream: true });
    let fullText = "";

    for await (const event of this.parseStream(stream)) {
      if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta?.type === "text_delta" && delta.text) {
          fullText += delta.text;
        }
      }
    }

    return fullText;
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = { LynkrRemoteClient };
}

// Example usage (run with: node examples/ai-james-client.js)
if (require.main === module) {
  async function main() {
    const tunnelUrl =
      process.env.LYNKR_TUNNEL_URL || "http://localhost:8081";
    const apiKey = process.env.REMOTE_ACCESS_API_KEY || "test-key";

    const client = new LynkrRemoteClient(tunnelUrl, apiKey);

    console.log("Checking health...");
    const healthy = await client.healthCheck();
    console.log(`Health: ${healthy ? "OK" : "FAILED"}`);

    if (!healthy) {
      console.error("Server not healthy, exiting");
      process.exit(1);
    }

    console.log("\nListing models...");
    const models = await client.listModels();
    console.log("Available models:", JSON.stringify(models, null, 2));

    console.log("\nSending test message...");
    const response = await client.sendMessageAndCollect({
      prompt: "What is 2 + 2?",
      sessionId: "ai-james-test",
      sessionName: "AI James Test Session",
    });
    console.log("Response:", response);
  }

  main().catch(console.error);
}
