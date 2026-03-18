import { editThought } from "../edit";
import * as api from "../../lib/api";

jest.mock("../../lib/api");

const mockCallTool = api.callTool as jest.MockedFunction<typeof api.callTool>;

beforeEach(() => {
  jest.clearAllMocks();
  mockCallTool.mockResolvedValue("Updated as observation — work");
});

describe("editThought", () => {
  it("calls update_thought with id and text", async () => {
    await editThought("thought-abc", "new text content", {});

    expect(mockCallTool).toHaveBeenCalledTimes(1);
    expect(mockCallTool).toHaveBeenCalledWith("update_thought", {
      id: "thought-abc",
      text: "new text content",
    });
  });

  it("includes scope in args when provided", async () => {
    await editThought("thought-abc", "new text", { scope: "shared" });

    expect(mockCallTool).toHaveBeenCalledWith("update_thought", {
      id: "thought-abc",
      text: "new text",
      scope: "shared",
    });
  });

  it("does not include scope in args when not provided", async () => {
    await editThought("thought-abc", "new text", {});

    const callArgs = mockCallTool.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("scope");
  });

  it("prints the result to stdout", async () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    await editThought("thought-abc", "new text", {});

    expect(consoleSpy).toHaveBeenCalledWith("Updated as observation — work");
    consoleSpy.mockRestore();
  });

  it("prints error message when callTool throws", async () => {
    mockCallTool.mockRejectedValue(new Error("network failure"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await editThought("thought-abc", "new text", {});

    // printError writes to stderr via console.error
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
