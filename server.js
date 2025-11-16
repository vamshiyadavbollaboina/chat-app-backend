const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// -------------------- DATABASE ABSTRACTION --------------------
// ⚠️ IMPORTANT: In a real application, you must replace these placeholder 
// functions with actual asynchronous calls to a database (e.g., Mongoose, Vercel KV).
// Since the functions are now asynchronous, all Express routes that call them MUST use 'await'.
const db = {
  // Placeholder for session storage. Replace with database connection.
  store: {}, 
  
  // Creates a new record
  async create(id, data) {
    this.store[id] = data;
    return this.store[id];
  },

  // Retrieves a record
  async get(id) {
    // Simulate database lookup delay
    await new Promise(resolve => setTimeout(resolve, 5)); 
    return this.store[id] || null;
  },

  // Updates a record
  async update(id, data) {
    this.store[id] = data;
    return this.store[id];
  },

  // Retrieves all records (Slow/inefficient in key-value stores)
  async listAll() {
    return Object.values(this.store);
  }
};
// --------------------------------------------------------------

const app = express();
// Use Vercel's assigned port in production, default to 5000 locally
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// -------------------- ASYNC UTILITY FUNCTIONS --------------------

/**
 * Creates a new session and persists it via the db interface.
 */
async function createSession(title = null) {
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const sTitle =
    title ||
    `Chat - ${new Date(createdAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })}`;

  const newSession = {
    id,
    title: sTitle,
    createdAt,
    messages: []
  };

  // 1. PERSIST: Save the new session using the async db.create function
  return await db.create(id, newSession);
}

/**
 * Lists all sessions from the database.
 */
async function listSessions() {
  const allSessions = await db.listAll();
  return allSessions
    .map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s.messages.length
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/**
 * Get a session from the database.
 */
async function getSession(id) {
  // 2. RETRIEVE ONE: Use the async db.get function
  return await db.get(id);
}

/**
 * Adds a message to a session and updates the record in the database.
 */
async function addMessage(sessionId, role, text, structured = null, feedback = null) {
  // 3. RETRIEVE & UPDATE: Get the session first
  const s = await getSession(sessionId); 
  if (!s) return null;

  const msg = {
    id: uuidv4(),
    role,
    text,
    structured,
    feedback,
    createdAt: new Date().toISOString()
  };

  s.messages.push(msg);

  // 4. PERSIST UPDATE: Save the modified session back to the database
  await db.update(sessionId, s); 
  return msg;
}

// Mock structured response (remains synchronous as it doesn't involve I/O)
function sampleStructuredResponse(query) {
  const now = new Date().toISOString();
  return {
    description: `Processed your query: "${query.substring(0, 20)}..."`,
    table: {
      headers: ['Metric', 'Value', 'Note'],
      rows: [
        ['Query Length', query.length, 'Characters'],
        ['Random Score (%)', (Math.random() * 100).toFixed(2), 'For demo'],
        ['Latency (ms)', (Math.random() * 300 + 100).toFixed(0), 'Mock']
      ],
      meta: { generatedAt: now }
    }
  };
}

// -------------------- ASYNC ROUTES --------------------

// Get all sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const sessionsList = await listSessions();
    res.json(sessionsList);
  } catch (error) {
    console.error("Error listing sessions:", error);
    res.status(500).json({ error: "Failed to retrieve sessions." });
  }
});

// Create a new session
app.get('/api/new-chat', async (req, res) => {
  try {
    const newSession = await createSession();
    res.json({ sessionId: newSession.id, createdAt: newSession.createdAt });
  } catch (error) {
    console.error("Error creating session:", error);
    res.status(500).json({ error: "Failed to create new session." });
  }
});

// Get session history
app.get('/api/session/:id', async (req, res) => {
  const session = await getSession(req.params.id);

  if (!session)
    return res.status(404).json({ error: 'Session not found' });

  const history = session.messages.map((msg) => ({
    id: msg.id,
    type: msg.role,
    content: msg.text,
    tabularData: msg.structured ? msg.structured.table : undefined,
    timestamp: msg.createdAt,
    feedback: msg.feedback || null
  }));
  res.json(history);
});

// Chat API
app.post('/api/chat/:id', async (req, res) => {
  const sessionId = req.params.id;
  const userQuestion = req.body.question;
  
  // Await the session retrieval
  const session = await getSession(sessionId); 

  if (!userQuestion || !session) {
    return res
      .status(400)
      .json({ error: 'Invalid session or missing question' });
  }

  // Await saving user message
  await addMessage(sessionId, 'user', userQuestion); 

  // Simulate delay + AI response
  // In a real app, this would be an API call to a service like OpenAI
  setTimeout(async () => {
    try {
      const structuredData = sampleStructuredResponse(userQuestion);
      
      // Await saving assistant message
      const assistantMessage = await addMessage( 
        sessionId,
        'assistant',
        structuredData.description,
        structuredData
      );
      
      // Retrieve the updated session to get the latest title
      const updatedSession = await getSession(sessionId);

      res.json({
        id: assistantMessage.id,
        type: assistantMessage.role,
        content: assistantMessage.text,
        tabularData: assistantMessage.structured.table,
        timestamp: assistantMessage.createdAt,
        feedback: assistantMessage.feedback || null,
        newTitle: updatedSession.title // Use updatedSession
      });
    } catch (error) {
       console.error("Error in chat response process:", error);
       // Send an error response if the async operations inside setTimeout fail
       res.status(500).json({ error: "Failed to process chat response." });
    }
  }, 1000);
});

// Feedback API
app.post('/api/messages/:id/feedback', async (req, res) => {
  const messageId = req.params.id;
  const { feedback } = req.body;
  
  if (!feedback) {
     return res.status(400).json({ error: 'Missing feedback' });
  }

  let found = false;
  
  // Await the list of all sessions
  const allSessions = await db.listAll(); 

  for (const session of allSessions) {
    const msg = session.messages.find(
      (m) => m.id === messageId && m.role === 'assistant'
    );
    if (msg) {
      msg.feedback = feedback;
      
      // Await saving the updated session back to the database
      await db.update(session.id, session); 
      found = true;
      break;
    }
  }

  if (!found)
    return res.status(404).json({ error: 'Message not found' });

  res.json({ success: true, feedback });
});

// -------------------- SERVER START --------------------
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} using port ${PORT}`);
});
