package jobs

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/dokploy/provisioner/db"
)

// Logger writes job output to both Postgres and an in-memory buffer
// that SSE clients can tail.
type Logger struct {
	jobID   string
	db      *db.DB
	mu      sync.Mutex
	lines   []string
	clients []chan string
}

func NewLogger(jobID string, database *db.DB) *Logger {
	return &Logger{jobID: jobID, db: database}
}

func (l *Logger) Write(line string) {
	l.mu.Lock()
	l.lines = append(l.lines, line)
	clients := make([]chan string, len(l.clients))
	copy(clients, l.clients)
	l.mu.Unlock()

	for _, ch := range clients {
		select {
		case ch <- line:
		default:
		}
	}

	if err := l.db.AppendJobLog(context.Background(), l.jobID, line); err != nil {
		log.Printf("failed to persist log for job %s: %v", l.jobID, err)
	}
}

// Subscribe returns a channel that receives new log lines and a list of
// previously buffered lines (for catch-up on reconnect).
func (l *Logger) Subscribe() ([]string, chan string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	prev := make([]string, len(l.lines))
	copy(prev, l.lines)
	ch := make(chan string, 256)
	l.clients = append(l.clients, ch)
	return prev, ch
}

func (l *Logger) Unsubscribe(ch chan string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for i, c := range l.clients {
		if c == ch {
			l.clients = append(l.clients[:i], l.clients[i+1:]...)
			close(ch)
			return
		}
	}
}

// Queue manages a pool of workers processing jobs.
type Queue struct {
	ch      chan *Job
	loggers sync.Map // jobID -> *Logger
	db      *db.DB
}

func NewQueue(database *db.DB, concurrency int) *Queue {
	return &Queue{
		ch: make(chan *Job, 64),
		db: database,
	}
}

func (q *Queue) Start(concurrency int, handler func(*Job, *Logger)) {
	for i := 0; i < concurrency; i++ {
		go func() {
			for job := range q.ch {
				logger, _ := q.loggers.Load(job.ID)
				l := logger.(*Logger)
				if err := q.db.UpdateJobStatus(context.Background(), job.ID, "running"); err != nil {
					log.Printf("failed to update job status: %v", err)
				}
				handler(job, l)
				// Allow SSE clients to receive final lines, then clean up the logger
				go func(id string) {
					<-time.After(30 * time.Second)
					q.loggers.Delete(id)
				}(job.ID)
			}
		}()
	}
}

func (q *Queue) Submit(job *Job) {
	logger := NewLogger(job.ID, q.db)
	q.loggers.Store(job.ID, logger)
	q.ch <- job
}

func (q *Queue) GetLogger(jobID string) (*Logger, bool) {
	v, ok := q.loggers.Load(jobID)
	if !ok {
		return nil, false
	}
	return v.(*Logger), true
}
