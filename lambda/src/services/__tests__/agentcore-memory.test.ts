/**
 * Tests for the AgentCore Memory service.
 */

// Mock the AWS SDK client before importing the module
const mockSend = jest.fn();
jest.mock("@aws-sdk/client-bedrock-agentcore", () => {
  return {
    BedrockAgentCoreClient: jest.fn(() => ({ send: mockSend })),
    CreateEventCommand: jest.fn((input: unknown) => ({ input })),
    ListEventsCommand: jest.fn((input: unknown) => ({ input })),
    RetrieveMemoryRecordsCommand: jest.fn((input: unknown) => ({ input })),
    Role: { USER: "USER", ASSISTANT: "ASSISTANT", TOOL: "TOOL", OTHER: "OTHER" },
  };
});

import {
  saveSessionEvent,
  loadSessionHistory,
  retrieveLongTermMemory,
  formatSessionHistory,
  extractAssistantText,
} from "../../services/agentcore-memory";

beforeEach(() => {
  mockSend.mockReset();
});

describe("saveSessionEvent", () => {
  it("calls CreateEventCommand with correct payload for user and assistant turns", async () => {
    mockSend.mockResolvedValue({ event: { eventId: "evt-1" } });

    await saveSessionEvent("mem-123", "user-abc", "session-xyz", [
      { role: "user", content: "What is the weather?" },
      { role: "assistant", content: "It is sunny." },
    ]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentCommand = mockSend.mock.calls[0][0];
    expect(sentCommand.input.memoryId).toBe("mem-123");
    expect(sentCommand.input.actorId).toBe("user-abc");
    expect(sentCommand.input.sessionId).toBe("session-xyz");
    expect(sentCommand.input.payload).toHaveLength(2);
    expect(sentCommand.input.payload[0].conversational.role).toBe("USER");
    expect(sentCommand.input.payload[0].conversational.content.text).toBe("What is the weather?");
    expect(sentCommand.input.payload[1].conversational.role).toBe("ASSISTANT");
    expect(sentCommand.input.payload[1].conversational.content.text).toBe("It is sunny.");
    expect(sentCommand.input.eventTimestamp).toBeInstanceOf(Date);
  });

  it("no-ops when memoryId is empty", async () => {
    await saveSessionEvent("", "user-abc", "session-xyz", [
      { role: "user", content: "hello" },
    ]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no-ops when turns array is empty", async () => {
    await saveSessionEvent("mem-123", "user-abc", "session-xyz", []);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("loadSessionHistory", () => {
  it("returns empty array when memoryId is empty", async () => {
    const result = await loadSessionHistory("", "user-abc", "session-xyz");
    expect(result).toEqual([]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns parsed events with conversation turns", async () => {
    mockSend.mockResolvedValue({
      events: [
        {
          eventId: "evt-1",
          eventTimestamp: new Date("2024-01-01T00:00:00Z"),
          payload: [
            {
              conversational: {
                role: "USER",
                content: { text: "Hello" },
              },
            },
            {
              conversational: {
                role: "ASSISTANT",
                content: { text: "Hi there!" },
              },
            },
          ],
        },
      ],
    });

    const result = await loadSessionHistory("mem-123", "user-abc", "session-xyz");

    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe("evt-1");
    expect(result[0].turns).toHaveLength(2);
    expect(result[0].turns[0]).toEqual({ role: "user", content: "Hello" });
    expect(result[0].turns[1]).toEqual({ role: "assistant", content: "Hi there!" });
  });

  it("calls ListEventsCommand with correct parameters", async () => {
    mockSend.mockResolvedValue({ events: [] });

    await loadSessionHistory("mem-123", "user-abc", "session-xyz", 15);

    const sentCommand = mockSend.mock.calls[0][0];
    expect(sentCommand.input.memoryId).toBe("mem-123");
    expect(sentCommand.input.actorId).toBe("user-abc");
    expect(sentCommand.input.sessionId).toBe("session-xyz");
    expect(sentCommand.input.maxResults).toBe(15);
    expect(sentCommand.input.includePayloads).toBe(true);
  });

  it("returns empty array and logs warning on API error", async () => {
    mockSend.mockRejectedValue(new Error("AccessDeniedException"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await loadSessionHistory("mem-123", "user-abc", "session-xyz");

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[agentcore-memory] loadSessionHistory failed"),
      expect.stringContaining("AccessDeniedException")
    );
    warnSpy.mockRestore();
  });

  it("handles events with no payload gracefully", async () => {
    mockSend.mockResolvedValue({
      events: [{ eventId: "evt-2", payload: [] }],
    });

    const result = await loadSessionHistory("mem-123", "user-abc", "session-xyz");
    expect(result).toHaveLength(1);
    expect(result[0].turns).toHaveLength(0);
  });

  it("skips TOOL and OTHER role turns — only includes USER and ASSISTANT", async () => {
    mockSend.mockResolvedValue({
      events: [
        {
          eventId: "evt-3",
          payload: [
            { conversational: { role: "USER", content: { text: "User message" } } },
            { conversational: { role: "TOOL", content: { text: "Tool result" } } },
            { conversational: { role: "OTHER", content: { text: "System info" } } },
            { conversational: { role: "ASSISTANT", content: { text: "Assistant reply" } } },
          ],
        },
      ],
    });

    const result = await loadSessionHistory("mem-123", "user-abc", "session-xyz");
    expect(result[0].turns).toHaveLength(2);
    expect(result[0].turns[0]).toEqual({ role: "user", content: "User message" });
    expect(result[0].turns[1]).toEqual({ role: "assistant", content: "Assistant reply" });
  });
});

describe("formatSessionHistory", () => {
  it("returns empty string for empty history", () => {
    expect(formatSessionHistory([])).toBe("");
  });

  it("returns empty string for history with no turns", () => {
    expect(formatSessionHistory([{ turns: [] }])).toBe("");
  });

  it("formats conversation turns correctly", () => {
    const history = [
      {
        turns: [
          { role: "user" as const, content: "What's the status?" },
          { role: "assistant" as const, content: "All green." },
        ],
      },
    ];

    const result = formatSessionHistory(history);
    expect(result).toBe("User: What's the status?\nAssistant: All green.");
  });

  it("concatenates turns across multiple events", () => {
    const history = [
      { turns: [{ role: "user" as const, content: "First message" }] },
      { turns: [{ role: "assistant" as const, content: "First reply" }] },
    ];

    const result = formatSessionHistory(history);
    expect(result).toBe("User: First message\nAssistant: First reply");
  });

  it("truncates oldest turns when history exceeds maxChars budget", () => {
    const history = [
      {
        turns: [
          { role: "user" as const, content: "Old message that should be dropped" },
          { role: "assistant" as const, content: "Old reply that should be dropped" },
          { role: "user" as const, content: "Recent question" },
          { role: "assistant" as const, content: "Recent answer" },
        ],
      },
    ];

    // Budget only fits the last two turns
    const result = formatSessionHistory(history, 60);
    expect(result).toBe("User: Recent question\nAssistant: Recent answer");
    expect(result).not.toContain("Old");
  });

  it("keeps all turns when within budget", () => {
    const history = [
      {
        turns: [
          { role: "user" as const, content: "Hi" },
          { role: "assistant" as const, content: "Hello" },
        ],
      },
    ];

    const result = formatSessionHistory(history, 10000);
    expect(result).toBe("User: Hi\nAssistant: Hello");
  });
});

describe("retrieveLongTermMemory", () => {
  it("returns empty string when memoryId is empty", async () => {
    const result = await retrieveLongTermMemory("", "/users/u1/preferences/", "preferences");
    expect(result).toBe("");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns formatted memory records", async () => {
    mockSend.mockResolvedValue({
      memoryRecordSummaries: [
        { memoryRecordId: "rec-1", content: { text: "Prefers dark mode" } },
        { memoryRecordId: "rec-2", content: { text: "Uses TypeScript" } },
      ],
    });

    const result = await retrieveLongTermMemory(
      "mem-123",
      "/users/user-abc/preferences/",
      "user interface preferences",
      5
    );

    expect(result).toBe("Prefers dark mode\n---\nUses TypeScript");
  });

  it("calls RetrieveMemoryRecordsCommand with correct parameters", async () => {
    mockSend.mockResolvedValue({ memoryRecordSummaries: [] });

    await retrieveLongTermMemory("mem-123", "/users/user-abc/preferences/", "workflow preferences", 3);

    const sentCommand = mockSend.mock.calls[0][0];
    expect(sentCommand.input.memoryId).toBe("mem-123");
    expect(sentCommand.input.namespace).toBe("/users/user-abc/preferences/");
    expect(sentCommand.input.searchCriteria.searchQuery).toBe("workflow preferences");
    expect(sentCommand.input.searchCriteria.topK).toBe(3);
  });

  it("returns empty string when no records found", async () => {
    mockSend.mockResolvedValue({ memoryRecordSummaries: [] });

    const result = await retrieveLongTermMemory("mem-123", "/users/u1/", "query");
    expect(result).toBe("");
  });

  it("returns empty string and logs warning on API error", async () => {
    mockSend.mockRejectedValue(new Error("ThrottledException"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await retrieveLongTermMemory("mem-123", "/users/u1/", "query");

    expect(result).toBe("");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[agentcore-memory] retrieveLongTermMemory failed"),
      expect.stringContaining("ThrottledException")
    );
    warnSpy.mockRestore();
  });

  it("filters out records with no text content", async () => {
    mockSend.mockResolvedValue({
      memoryRecordSummaries: [
        { memoryRecordId: "rec-1", content: { text: "Valid memory" } },
        { memoryRecordId: "rec-2", content: { $unknown: {} } },
      ],
    });

    const result = await retrieveLongTermMemory("mem-123", "/users/u1/", "query");
    expect(result).toBe("Valid memory");
  });
});

describe("extractAssistantText", () => {
  it("returns the top-level text when present", () => {
    expect(extractAssistantText({ text: "Hello world", steps: [] })).toBe("Hello world");
  });

  it("falls back to collecting text from steps when top-level text is empty", () => {
    const result = extractAssistantText({
      text: "",
      steps: [{ text: "Step 1 output" }, { text: "Step 2 output" }],
    });
    expect(result).toBe("Step 1 output\nStep 2 output");
  });

  it("returns empty string when no text at all", () => {
    expect(extractAssistantText({ steps: [{ text: "" }, {}] })).toBe("");
  });

  it("handles missing steps array", () => {
    expect(extractAssistantText({ text: "Direct answer" })).toBe("Direct answer");
  });
});
