const { v4: uuidv4 } = require("uuid");

// ---------------- MEMORY (persists on warm instances) ----------------
let sessions = {};

// ---------------- UTIL FUNCTIONS ----------------

function createSession(title = null) {
  const id = uuidv4();
  const createdAt = new Date().toISOString();

  const sTitle =
    title ||
    `Chat - ${new Date(createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`;

  sessions[id] = {
    id,
    title: sTitle,
    createdAt,
    messages: [],
  };

  return sessions[id];
}

function listSessions() {
  return Object.values(sessions)
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s.messages.length,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getSession(id) {
  return sessions[id] || null;
}

function addMessage(sessionId, role, text, structured = null, feedback = null) {
  const s = sessions[sessionId];
  if (!s) return null;

  const msg = {
    id: uuidv4(),
    role,
    text,
    structured,
    feedback,
    createdAt: new Date().toISOString(),
  };

  s.messages.push(msg);
  return msg;
}

function structuredReply(query) {
  const now = new Date().toISOString();

  return {
    description: `Processed your query: "${query.substring(0, 20)}..."`,
    table: {
      headers: ["Metric", "Value", "Note"],
      rows: [
        ["Query Length", query.length, "Characters"],
        ["Random Score (%)", (Math.random() * 100).toFixed(2), "Demo"],
        ["Latency (ms)", (Math.random() * 300 + 100).toFixed(0), "Mock"],
      ],
      meta: { generatedAt: now },
    },
  };
}

// ----------------------------------------------------------------------
//                       SERVERLESS HANDLER
// ----------------------------------------------------------------------

exports.handler = async (event) => {
  const { path, httpMethod } = event;

  // Enable CORS
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  };

  // Preflight CORS
  if (httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  // ---------------- ROUTES ----------------

  // GET /api/sessions
  if (path === "/api/sessions" && httpMethod === "GET") {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(listSessions()),
    };
  }

  // GET /api/new-chat
  if (path === "/api/new-chat" && httpMethod === "GET") {
    const session = createSession();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        sessionId: session.id,
        createdAt: session.createdAt,
      }),
    };
  }

  // GET /api/session/:id
  if (path.startsWith("/api/session/") && httpMethod === "GET") {
    const id = path.split("/").pop();
    const session = getSession(id);

    if (!session) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Session not found" }),
      };
    }

    const history = session.messages.map((m) => ({
      id: m.id,
      type: m.role,
      content: m.text,
      tabularData: m.structured ? m.structured.table : undefined,
      timestamp: m.createdAt,
      feedback: m.feedback || null,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(history),
    };
  }

  // POST /api/chat/:id
  if (path.startsWith("/api/chat/") && httpMethod === "POST") {
    const id = path.split("/").pop();
    const session = getSession(id);

    if (!session) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid session" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const question = body.question;

    if (!question) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing question" }),
      };
    }

    // Save user message
    addMessage(id, "user", question);

    // Generate assistant reply
    const structuredData = structuredReply(question);
    const assistant = addMessage(
      id,
      "assistant",
      structuredData.description,
      structuredData
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        id: assistant.id,
        type: assistant.role,
        content: assistant.text,
        tabularData: assistant.structured.table,
        timestamp: assistant.createdAt,
        feedback: assistant.feedback || null,
        newTitle: session.title,
      }),
    };
  }

  // POST /api/messages/:id/feedback
  if (path.startsWith("/api/messages/") && httpMethod === "POST") {
    const messageId = path.split("/").pop();
    const { feedback } = JSON.parse(event.body || "{}");

    let found = false;

    for (const session of Object.values(sessions)) {
      const msg = session.messages.find(
        (m) => m.id === messageId && m.role === "assistant"
      );
      if (msg) {
        msg.feedback = feedback;
        found = true;
        break;
      }
    }

    if (!found) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Message not found" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, feedback }),
    };
  }

  // Unknown route
  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: "Route not found" }),
  };
};
