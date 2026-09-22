---
title: System Architecture Overview
---

# System Architecture Overview

```mermaid
flowchart TD
  subgraph Ingestion [Ingestion Layer]
    API[API Gateway]:::existing
    Queue[Event Bus]:::new
  end
  subgraph Processing [Processing Core]
    Worker[Worker Pool]:::new
    DB[(Primary Database)]:::existing
  end

  API --> Queue
  Queue --> Worker
  Worker --> DB

  classDef existing fill:#1e293b,stroke:#64748b,stroke-width:2px,color:#f8fafc;
  classDef new fill:#1e3a8a,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;
```

## 1. API Gateway
Status: existing
Summary: Handles external ingress, authentication, and request routing.

## 2. Event Bus
Status: new
Summary: Decouples intake from processing with persistent buffering.

## 3. Worker Pool
Status: new
Summary: Scalable asynchronous execution workers.

## 4. Primary Database
Status: existing
Summary: Relational database storing core transactional entities.
