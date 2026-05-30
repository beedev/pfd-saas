/**
 * @dxp/ai-assistant — Storybook stories
 *
 * Shows the Conversational AI Assistant components available to any portal.
 * Note: The full interactive components (AgenticAssistant, ConfigBuilder) need
 * a running backend. These stories show the static UI elements.
 */

import React, { useState } from 'react';
import { Card, CardHeader, CardContent, Badge, Button } from '../index';

export default {
  title: 'AI Assistant',
};

// ── Integration Recipe ──────────────────────────────────────────────────────

export const HowToAdd = () => (
  <div style={{ maxWidth: '800px', padding: '2rem' }}>
    <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>
      Add Conversational AI to Any Portal
    </h1>
    <p style={{ color: 'var(--dxp-text-secondary)', marginBottom: '2rem' }}>
      3 steps. Zero copy-paste. Works for retail, insurance, wealth, healthcare — any vertical.
    </p>

    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge variant="brand">Step 1</Badge>
            <h2 style={{ fontWeight: 700 }}>Add the dependency</h2>
          </div>
        </CardHeader>
        <CardContent>
          <pre style={{ background: 'var(--dxp-border-light)', padding: '1rem', borderRadius: 'var(--dxp-radius)', fontSize: '0.8rem', overflow: 'auto' }}>
{`// package.json
"dependencies": {
  "@dxp/ai-assistant": "workspace:*"
}

// tailwind.config.js
content: [
  '../../packages/ai-assistant/src/**/*.{ts,tsx}',
]`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge variant="brand">Step 2</Badge>
            <h2 style={{ fontWeight: 700 }}>Import and route</h2>
          </div>
        </CardHeader>
        <CardContent>
          <pre style={{ background: 'var(--dxp-border-light)', padding: '1rem', borderRadius: 'var(--dxp-radius)', fontSize: '0.8rem', overflow: 'auto' }}>
{`import {
  AgenticAssistant,    // Customer chat
  AgenticPlayground,   // Combined demo
  AgentReadiness,      // Data quality dashboard
  ConfigBuilder,       // Persona generator
  DataPipeline,        // Data ingestion UI
} from '@dxp/ai-assistant';

// Customer nav
{ label: 'AI Assistant', href: '/customer/ai-assistant' }

// Manager nav
{ label: 'Agentic Playground', href: '/manager/playground' }
{ label: 'Agent Readiness',    href: '/manager/readiness' }
{ label: 'Config Builder',     href: '/manager/config' }
{ label: 'Data Pipeline',      href: '/manager/pipeline' }`}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge variant="brand">Step 3</Badge>
            <h2 style={{ fontWeight: 700 }}>Setup the backend</h2>
          </div>
        </CardHeader>
        <CardContent>
          <pre style={{ background: 'var(--dxp-border-light)', padding: '1rem', borderRadius: 'var(--dxp-radius)', fontSize: '0.8rem', overflow: 'auto' }}>
{`cd apps/conversational-assistant
./setup.sh

# Run
pnpm nx run conversational-assistant:dev

# Switch vertical
AGENTIC_CONFIG_ID=insurance-claims pnpm nx run conversational-assistant:dev`}
          </pre>
        </CardContent>
      </Card>
    </div>
  </div>
);

HowToAdd.storyName = 'How to Add';

// ── What You Get ──────────────────────────────────────────────────────────

export const WhatYouGet = () => {
  const capabilities = [
    { name: 'AgenticAssistant', type: 'Component', desc: 'Customer-facing AI chat with voice, uploads, cart, preferences' },
    { name: 'AgenticPlayground', type: 'Page', desc: 'Combined demo: chat + configs + readiness + builder in tabs' },
    { name: 'AgentReadiness', type: 'Page', desc: 'Data quality dashboard — 5 dimensions scored 0-100' },
    { name: 'ConfigBuilder', type: 'Page', desc: 'Describe domain in natural language → LLM generates full config' },
    { name: 'DataPipeline', type: 'Page', desc: 'Upload data → ingest into vector DB → enrich knowledge graph' },
    { name: 'useAgentChat', type: 'Hook', desc: 'WebSocket state management — messages, agents steps, cart, uploads' },
    { name: 'MessageBubble', type: 'Component', desc: 'Chat message rendering with markdown + speak button' },
    { name: 'ProductCard', type: 'Component', desc: 'Product display with price, rating, discount, add-to-cart' },
    { name: 'AgentStepCard', type: 'Component', desc: 'Agent activity step with tool name + status icon' },
    { name: 'PreferencesPanel', type: 'Component', desc: 'Shows learned user preferences with confidence bars' },
    { name: 'MicButton', type: 'Component', desc: 'Record audio → Whisper transcription → auto-send' },
    { name: 'SpeakButton', type: 'Component', desc: 'TTS playback of assistant messages' },
    { name: 'UploadButton', type: 'Component', desc: 'File upload (images + PDFs) with chips preview' },
  ];

  return (
    <div style={{ maxWidth: '800px', padding: '2rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1.5rem' }}>
        @dxp/ai-assistant — What You Get
      </h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {capabilities.map((c) => (
          <div key={c.name} style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', borderRadius: 'var(--dxp-radius)',
            border: '1px solid var(--dxp-border-light)',
          }}>
            <Badge variant={c.type === 'Page' ? 'brand' : c.type === 'Hook' ? 'info' : 'default'}>
              {c.type}
            </Badge>
            <div style={{ flex: 1 }}>
              <code style={{ fontWeight: 700, fontSize: '0.85rem' }}>{c.name}</code>
              <p style={{ fontSize: '0.75rem', color: 'var(--dxp-text-muted)', marginTop: '0.15rem' }}>
                {c.desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

WhatYouGet.storyName = 'What You Get';

// ── Architecture ──────────────────────────────────────────────────────────

export const Architecture = () => (
  <div style={{ maxWidth: '800px', padding: '2rem' }}>
    <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1rem' }}>
      Architecture
    </h1>
    <pre style={{
      background: 'var(--dxp-border-light)', padding: '1.5rem',
      borderRadius: 'var(--dxp-radius)', fontSize: '0.75rem',
      lineHeight: 1.6, overflow: 'auto',
    }}>
{`Portal (React)              BFF (NestJS)                Agent Backend (FastAPI)
┌──────────────┐      ┌──────────────────┐      ┌─────────────────────────┐
│@dxp/ai-asst  │──WS─▶│ AgenticModule    │──WS─▶│ ReAct Agent (LangGraph) │
│              │      │ LangGraphAdapter │      │ 10 tools, JSON persona  │
│ Chat + Voice │      │ or MockAdapter   │      │ pgvector + Apache AGE   │
│ Upload + Cart│      └──────────────────┘      └─────────────────────────┘
└──────────────┘

Supported verticals (config-driven, no code changes):
  ✓ Retail / Hardware    ✓ Insurance / Claims
  ✓ Wealth / Advisory    ✓ Healthcare / Provider
  ✓ Any custom domain via Config Builder`}
    </pre>
    <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      {['ReAct Agent', 'OpenAI GPT-4.1', 'Whisper STT', 'TTS-1', 'pgvector', 'Apache AGE', 'LangGraph', 'Langfuse'].map(t => (
        <Badge key={t} variant="default">{t}</Badge>
      ))}
    </div>
  </div>
);
