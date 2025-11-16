const { v4: uuidv4 } = require("uuid");
// ⚠️ NOTE: You must install the Vercel KV SDK: `npm install @vercel/kv`
// const { kv } = require("@vercel/kv"); 
// 
// --- Placeholder for Vercel KV Client ---
// For demonstration, we will use a temporary in-memory object 
// that will cause issues on cold starts, but shows the database structure.
// In a real deployment, replace this with actual database calls.
let sessions = {}; 
const kv = {
  get: async (key) => sessions[key],
  set: async (key, value) => { sessions[key] = value; return value; },
  keys: async () => Object.keys(sessions),
  del: async (key) => { delete sessions[key]; return true; },
};
// ----------------------------------------


// ---------------- UTIL FUNCTIONS ----------------

/**
 * Creates a new session and persists it to the database.
 */
async function createSession(title = null) {
  const id = uuidv4();
  const createdAt = new Date().toISOString();

  const sTitle =
    title ||
    `Chat - ${new Date(createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`;

  const newSession = {
    id,
    title: sTitle,
    createdAt,
    messages: [],
  };

  // 1. PERSIST: Save the new session to the external store (e.g., Vercel KV)
  await kv.set(`session:${id}`, newSession);

  return newSession;
}

/**
 * Lists all sessions from the database. (Requires getting all keys, which is slow/expensive)
 * In production, you would need a proper DB index for this.
 */
async function listSessions() {
  // 2. RETRIEVE ALL: Simulate retrieving all sessions. This operation is often 
  // slow/expensive in key-value stores and should be optimized in a real app.
  const sessionKeys = await kv.keys("session:*");
  const sessionPromises = sessionKeys.map(key => kv.get(key));
  const sessionObjects = await Promise.all(sessionPromises);

  return sessionObjects
    .filter(s => s != null) // Filter out any nulls
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s.messages.length,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Retrieves a single session by ID from the database.
 */
async function getSession(id) {
  // 3. RETRIEVE ONE: Get the session object from the external store
  return await kv.get(`session:${id}`);
}

/**
 * Adds a message to a session and updates the record in the database.
 */
async function addMessage(sessionId, role, text, structured = null, feedback = null) {
  // 4. TRANSACTION/UPDATE: Get, modify, then set (requires atomic operations in production)
  const s = await getSession(sessionId);
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

  // Update the session record in the external store
  await kv.set(`session:${sessionId}`, s);

  return msg;
}

function structuredReply(query) {
  const now = new Date().toISOString();
  // (Function logic remains the same)
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

// ---------------- SERVERLESS HANDLER ----------------

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  };

  try {
    // Preflight CORS
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 200, headers };
    }

    const path = event.path || "/";
    const pathSegments = path.split("/").filter(Boolean);

    // ---------------- ROUTES ----------------

    // GET /sessions
    if (path.endsWith("/sessions") && event.httpMethod === "GET") {
      const sessionsList = await listSessions();
      return { statusCode: 200, headers, body: JSON.stringify(sessionsList) };
    }

    // GET /new-chat
    if (path.endsWith("/new-chat") && event.httpMethod === "GET") {
      const session = await createSession();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ sessionId: session.id, createdAt: session.createdAt }),
      };
    }

    // GET /session/:id
    if (path.includes("/session/") && event.httpMethod === "GET" && pathSegments.length === 2) {
      const id = pathSegments.pop();
      const session = await getSession(id);

      if (!session) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Session not found" }) };
      }

      const history = session.messages.map((m) => ({
        id: m.id,
        type: m.role,
        content: m.text,
        tabularData: m.structured ? m.structured.table : undefined,
        timestamp: m.createdAt,
        feedback: m.feedback || null,
      }));

      return { statusCode: 200, headers, body: JSON.stringify(history) };
    }

    // POST /chat/:id
    if (path.includes("/chat/") && event.httpMethod === "POST" && pathSegments.length === 2) {
      const id = pathSegments.pop();
      const session = await getSession(id); // Use the async getSession

      if (!session) {
        // Now returns 404/400 instead of crashing if the session ID is not found
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid session" }) };
      }

      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
      }

      const question = body.question;
      if (!question) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing question" }) };
      }

      // Use async addMessage
      await addMessage(id, "user", question);
      
      const structuredData = structuredReply(question);
      const assistant = await addMessage(id, "assistant", structuredData.description, structuredData);

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

    // POST /messages/:id/feedback
    if (path.includes("/messages/") && event.httpMethod === "POST" && pathSegments.length === 3 && pathSegments[1] === "messages") {
      const messageId = pathSegments.pop();

      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
      }

      const feedback = body.feedback;
      if (!feedback) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing feedback" }) };
      }

      // 5. FIND & UPDATE: Iterate through all sessions to find the message
      const sessionKeys = await kv.keys("session:*");
      const sessionPromises = sessionKeys.map(key => kv.get(key));
      const allSessions = await Promise.all(sessionPromises);

      let found = false;
      for (const session of allSessions) {
        if (!session) continue;
        const msg = session.messages.find((m) => m.id === messageId && m.role === "assistant");
        
        if (msg) {
          msg.feedback = feedback;
          // Update the session record in the external store
          await kv.set(`session:${session.id}`, session); 
          found = true;
          break;
        }
      }

      if (!found) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Message not found" }) };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, feedback }) };
    }

    // Unknown route
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Route not found" }) };
  } catch (err) {
    console.error("Function crashed:", err);
    // The main error handler remains for unexpected errors
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};
