# Stage 1

## REST API Design for Campus Notification Platform

### Core Actions the Notification Platform Should Support

- Fetch all notifications for a logged-in student
- Mark a notification as read
- Mark all notifications as read
- Delete a notification
- Fetch unread notification count

### REST API Endpoints

#### 1. Get All Notifications
```
GET /api/notifications
Authorization: Bearer <token>

Response 200:
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement" | "Event" | "Result",
      "message": "string",
      "isRead": false,
      "createdAt": "2026-04-22T17:51:30Z"
    }
  ]
}
```

#### 2. Mark a Notification as Read
```
PATCH /api/notifications/:id/read
Authorization: Bearer <token>

Response 200:
{
  "message": "Notification marked as read"
}
```

#### 3. Mark All Notifications as Read
```
PATCH /api/notifications/read-all
Authorization: Bearer <token>

Response 200:
{
  "message": "All notifications marked as read"
}
```

#### 4. Delete a Notification
```
DELETE /api/notifications/:id
Authorization: Bearer <token>

Response 200:
{
  "message": "Notification deleted"
}
```

#### 5. Get Unread Count
```
GET /api/notifications/unread-count
Authorization: Bearer <token>

Response 200:
{
  "unreadCount": 5
}
```

### Real-Time Notification Mechanism

Use **WebSockets** (via Socket.IO) for real-time delivery.

- When a new notification is created, the server emits an event to the student's socket room
- Each student connects with their studentID and joins a room like `room:studentID`
- The server emits `new_notification` event with the notification payload
- The frontend listens and updates the UI instantly without page reload

```
// Server emits:
io.to(`room:${studentID}`).emit("new_notification", {
  id: "uuid",
  type: "Placement",
  message: "TCS hiring drive tomorrow",
  createdAt: "2026-04-22T17:51:30Z"
});
```

---

# Stage 2

## Database Design for Notification Platform

### Recommended Database: PostgreSQL (Relational)

**Why PostgreSQL?**
- Notifications have a clear, structured schema with defined fields
- We need to query by studentID, filter by isRead, sort by createdAt — all well-suited for SQL
- ACID compliance ensures no notification is lost
- Easy to add indexes for performance

### DB Schema

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studentID INT NOT NULL,
  type notification_type NOT NULL,
  message TEXT NOT NULL,
  isRead BOOLEAN DEFAULT false,
  createdAt TIMESTAMP DEFAULT NOW()
);

CREATE TYPE notification_type AS ENUM ('Event', 'Result', 'Placement');
```

### Problems as Data Volume Increases

- Query `SELECT * FROM notifications WHERE studentID = X AND isRead = false` becomes slow without indexes
- Table grows to millions of rows, full scans become expensive
- Older notifications slow down reads for active users

### Solutions

- Add indexes on `studentID`, `isRead`, and `createdAt`
- Archive old notifications to a separate table
- Partition the table by `createdAt` (monthly partitions)

### SQL Queries Based on Stage 1 APIs

```sql
-- Get all notifications for a student
SELECT * FROM notifications
WHERE studentID = 1042
ORDER BY createdAt DESC;

-- Mark one notification as read
UPDATE notifications
SET isRead = true
WHERE id = 'uuid-here';

-- Mark all as read
UPDATE notifications
SET isRead = true
WHERE studentID = 1042;

-- Delete a notification
DELETE FROM notifications
WHERE id = 'uuid-here';

-- Get unread count
SELECT COUNT(*) FROM notifications
WHERE studentID = 1042 AND isRead = false;
```

---

# Stage 3

## Query Analysis and Optimization

### Original Query
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### Is this query accurate?
Yes, the query is logically correct — it fetches unread notifications for a student sorted by newest first.

### Why is it slow?
- No indexes on `studentID`, `isRead`, or `createdAt`
- `SELECT *` fetches all columns including large `message` text
- With 5,000,000 rows, PostgreSQL does a full table scan

### What to change?
```sql
-- Add a composite index
CREATE INDEX idx_notifications_student_unread
ON notifications (studentID, isRead, createdAt DESC);

-- Use selective columns instead of SELECT *
SELECT id, type, message, createdAt FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

### Should we index every column?
No. Indexing every column is bad advice because:
- Each index increases storage space
- Every INSERT/UPDATE becomes slower as all indexes must be updated
- Only index columns used in WHERE, ORDER BY, or JOIN clauses

### Query to find students with placement notifications in last 7 days
```sql
SELECT DISTINCT studentID FROM notifications
WHERE notificationType = 'Placement'
AND createdAt >= NOW() - INTERVAL '7 days';
```

---

# Stage 4

## Caching Strategy for Notifications

### Problem
Fetching notifications on every page load overwhelms the database at scale (50,000 students).

### Suggested Solutions

#### 1. Redis Cache (Recommended)
- Cache each student's notifications list in Redis with key `notifications:studentID`
- Set TTL (Time To Live) of 60 seconds
- On page load, check Redis first — if hit, return cached data; if miss, query DB and store in cache
- On new notification or read status change, invalidate that student's cache key

**Tradeoffs:**
- Pro: Extremely fast reads, reduces DB load by 90%+
- Con: Slight staleness (up to TTL seconds), extra infrastructure cost

#### 2. HTTP Cache Headers
- Use `Cache-Control: max-age=30` on the notifications API response
- Browser caches the response and avoids repeat requests

**Tradeoffs:**
- Pro: Zero backend cost, simple to implement
- Con: Client-side only, doesn't help server load from multiple devices

#### 3. Pagination
- Don't load all notifications at once — load 20 at a time
- Reduces data transferred per request significantly

**Tradeoffs:**
- Pro: Reduces payload size and DB query cost
- Con: Requires frontend changes, users must scroll to load more

---

# Stage 5

## Redesigning notify_all for Reliability

### Original Pseudocode Problems
```
function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)
    save_to_db(student_id, message)
    push_to_app(student_id, message)
```

### Shortcomings
- Synchronous loop over 50,000 students is extremely slow
- If `send_email` fails for student 200, the loop stops — remaining 49,800 students get nothing
- No retry mechanism for failed emails
- DB save and email are tightly coupled — if DB is slow, email is delayed
- No way to track which students received the notification

### Redesigned Pseudocode with Message Queue

```
function notify_all(student_ids, message):
  notification_id = save_notification_to_db(message)  // single DB insert
  
  for student_id in student_ids:
    enqueue("email_queue", { student_id, message, notification_id })
    enqueue("push_queue", { student_id, message, notification_id })

// Email Worker (runs separately, processes email_queue)
function email_worker():
  job = dequeue("email_queue")
  try:
    send_email(job.student_id, job.message)
    mark_delivered(job.notification_id, job.student_id, "email")
  catch error:
    if job.retries < 3:
      re_enqueue("email_queue", job with retries+1)
    else:
      log_failed(job.student_id, "email")

// Push Worker (runs separately, processes push_queue)
function push_worker():
  job = dequeue("push_queue")
  try:
    push_to_app(job.student_id, job.message)
    mark_delivered(job.notification_id, job.student_id, "push")
  catch error:
    re_enqueue("push_queue", job with retries+1)
```

### Should DB save and email happen together?
No. They should be decoupled because:
- DB save is fast and must always succeed first to record the notification
- Email sending is slow and can fail — it should be retried independently
- If both are in the same transaction, a failed email would roll back the DB save, losing the notification record entirely

---

# Stage 6

## Priority Inbox Implementation

### Approach
Priority is determined by two factors:
- **Type weight**: Placement (3) > Result (2) > Event (1)
- **Recency**: More recent notifications rank higher within the same type

### Algorithm: Max-Heap (Priority Queue)
- Each notification is scored as: `score = typeWeight * 1000000000 + timestamp`
- A max-heap always keeps the highest scored notification at the top
- For top-N: extract N times from the heap
- For streaming new notifications: insert into heap and remove the lowest if size exceeds N

### Why a Heap?
- Inserting a new notification: O(log N)
- Getting top N: O(N log N)
- Much more efficient than sorting the full list on every new notification O(K log K) where K = total notifications

### Tradeoffs
- Heap gives O(log N) insert which is ideal for real-time streaming
- Simple array sort is easier to implement but O(K log K) on every update
- For 50,000 students each with hundreds of notifications, heap is significantly faster