const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 5000;

const sessions = {}; // sessionId -> { id, title, createdAt, messages: [] }

function createSession(title = null) {
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const sTitle = title || `Chat - ${new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  sessions[id] = { id, title: sTitle, createdAt, messages: [] };
  console.log(`Created new session: ${id}`);
  return sessions[id];
}

function listSessions() {
  return Object.values(sessions)
    .map(s => ({
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

  const msg = { id: uuidv4(), role, text, structured, feedback, createdAt: new Date().toISOString() };
  s.messages.push(msg);

  return msg;
}

function sampleStructuredResponse(query) {
  const now = new Date().toISOString();
  return {
    description: `Here is a mock analysis for your query about "${query.substring(0, 20)}...":`,
    table: {
      headers: ['Metric', 'Value', 'Note'],
      rows: [
        ['Query Length (chars)', query.length, 'Input metric'],
        ['Success Rate (%)', (Math.random() * 100).toFixed(2), 'Mock data'],
        ['Latency (ms)', (Math.random() * 400 + 100).toFixed(0), 'Mock avg time'],
      ],
      meta: { generatedAt: now },
    },
  };
}

app.use(cors());
app.use(express.json());

app.get('/api/sessions', (req, res) => {
  res.json(listSessions());
});

app.get('/api/new-chat', (req, res) => {
  const newSession = createSession();
  res.json({ sessionId: newSession.id, createdAt: newSession.createdAt });
});

app.get('/api/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const history = session.messages.map(msg => ({
    id: msg.id,
    type: msg.role,
    content: msg.text,
    tabularData: msg.structured ? msg.structured.table : undefined,
    timestamp: msg.createdAt,
    feedback: msg.feedback || null,
  }));

  res.json(history);
});

app.post('/api/chat/:id', (req, res) => {
  const sessionId = req.params.id;
  const userQuestion = req.body.question;

  if (!userQuestion || !getSession(sessionId)) {
    return res.status(400).json({ error: 'Invalid session or missing question' });
  }

  addMessage(sessionId, 'user', userQuestion);

  setTimeout(() => {
    const structuredData = sampleStructuredResponse(userQuestion);
    const assistantMessage = addMessage(
      sessionId,
      'assistant',
      structuredData.description,
      structuredData
    );

    const session = getSession(sessionId);

    res.json({
      id: assistantMessage.id,
      type: assistantMessage.role,
      content: assistantMessage.text,
      tabularData: assistantMessage.structured.table,
      timestamp: assistantMessage.createdAt,
      feedback: assistantMessage.feedback || null,
      newTitle: session.title,
    });
  }, 1000);
});

app.post('/api/messages/:id/feedback', (req, res) => {
  const messageId = req.params.id;
  const { feedback } = req.body; // 'like' or 'dislike'

  let found = false;
  for (const session of Object.values(sessions)) {
    const msg = session.messages.find(m => m.id === messageId && m.role === 'assistant');
    if (msg) {
      msg.feedback = feedback;
      found = true;
      break;
    }
  }

  if (!found) return res.status(404).json({ error: 'Message not found' });

  res.json({ success: true, feedback });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
