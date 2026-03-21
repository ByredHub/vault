"""
Database layer — SQLite with aiosqlite.
Handles orders, users, and settings.
"""
import aiosqlite
import time
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent.parent / "data.db"


async def get_db() -> aiosqlite.Connection:
    """Get database connection."""
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db() -> None:
    """Initialize database schema."""
    db = await get_db()
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                joined_at INTEGER NOT NULL DEFAULT 0,
                total_orders INTEGER NOT NULL DEFAULT 0,
                total_spent REAL NOT NULL DEFAULT 0.0,
                is_blocked INTEGER NOT NULL DEFAULT 0,
                stars_balance INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                lzt_item_id INTEGER NOT NULL,
                item_title TEXT NOT NULL DEFAULT '',
                item_category TEXT NOT NULL DEFAULT '',
                original_price REAL NOT NULL DEFAULT 0.0,
                sell_price REAL NOT NULL DEFAULT 0.0,
                profit REAL NOT NULL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'pending',
                payment_method TEXT NOT NULL DEFAULT '',
                payment_id TEXT NOT NULL DEFAULT '',
                account_data TEXT,
                created_at INTEGER NOT NULL DEFAULT 0,
                paid_at INTEGER,
                completed_at INTEGER,
                error_message TEXT,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
            CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
        """)
        await db.commit()

        # Migrate: add stars_balance if missing
        try:
            await db.execute("ALTER TABLE users ADD COLUMN stars_balance INTEGER NOT NULL DEFAULT 0")
            await db.commit()
        except Exception:
            pass  # column already exists

        # Migrate: tickets table
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                created_at INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                sender TEXT NOT NULL DEFAULT 'user',
                message TEXT NOT NULL DEFAULT '',
                attachments TEXT,
                created_at INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (ticket_id) REFERENCES tickets(id)
            );
            CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
            CREATE INDEX IF NOT EXISTS idx_tmsg_ticket ON ticket_messages(ticket_id);
        """)
        await db.commit()
    finally:
        await db.close()


# ═══════════════════════════════════════
# User operations
# ═══════════════════════════════════════

async def upsert_user(user_id: int, username: str | None, first_name: str | None) -> None:
    """Create or update user record."""
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO users (user_id, username, first_name, joined_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
                 username = excluded.username,
                 first_name = excluded.first_name""",
            (user_id, username or "", first_name or "", int(time.time())),
        )
        await db.commit()
    finally:
        await db.close()


async def get_user(user_id: int) -> Optional[dict]:
    """Get user by ID."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE user_id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_all_users(limit: int = 100, offset: int = 0) -> list[dict]:
    """Get all users with pagination."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM users ORDER BY joined_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_user_count() -> int:
    """Get total user count."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM users")
        row = await cursor.fetchone()
        return row["cnt"] if row else 0
    finally:
        await db.close()


async def block_user(user_id: int, blocked: bool = True) -> None:
    """Block or unblock a user."""
    db = await get_db()
    try:
        await db.execute("UPDATE users SET is_blocked = ? WHERE user_id = ?", (int(blocked), user_id))
        await db.commit()
    finally:
        await db.close()


async def get_user_balance(user_id: int) -> int:
    """Get user's Stars balance."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT stars_balance FROM users WHERE user_id = ?", (user_id,))
        row = await cursor.fetchone()
        return row["stars_balance"] if row else 0
    finally:
        await db.close()


async def deposit_stars(user_id: int, amount: int) -> int:
    """Add Stars to user balance. Returns new balance."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE users SET stars_balance = stars_balance + ? WHERE user_id = ?",
            (amount, user_id),
        )
        await db.commit()
        cursor = await db.execute("SELECT stars_balance FROM users WHERE user_id = ?", (user_id,))
        row = await cursor.fetchone()
        return row["stars_balance"] if row else 0
    finally:
        await db.close()


async def withdraw_stars(user_id: int, amount: int) -> bool:
    """Deduct Stars from user balance. Returns True if sufficient funds."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT stars_balance FROM users WHERE user_id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row or row["stars_balance"] < amount:
            return False
        await db.execute(
            "UPDATE users SET stars_balance = stars_balance - ? WHERE user_id = ?",
            (amount, user_id),
        )
        await db.commit()
        return True
    finally:
        await db.close()

# ═══════════════════════════════════════
# Order operations
# ═══════════════════════════════════════

async def create_order(
    user_id: int,
    lzt_item_id: int,
    item_title: str,
    item_category: str,
    original_price: float,
    sell_price: float,
    payment_method: str,
) -> int:
    """Create a new order and return its ID."""
    profit = round(sell_price - original_price, 2)
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO orders
               (user_id, lzt_item_id, item_title, item_category,
                original_price, sell_price, profit, status,
                payment_method, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)""",
            (user_id, lzt_item_id, item_title, item_category,
             original_price, sell_price, profit, payment_method,
             int(time.time())),
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def get_order(order_id: int) -> Optional[dict]:
    """Get order by ID."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def update_order_status(
    order_id: int,
    status: str,
    payment_id: str | None = None,
    account_data: str | None = None,
    error_message: str | None = None,
) -> None:
    """Update order status and related fields."""
    now = int(time.time())
    db = await get_db()
    try:
        fields = ["status = ?"]
        values: list = [status]

        if payment_id is not None:
            fields.append("payment_id = ?")
            values.append(payment_id)
        if account_data is not None:
            fields.append("account_data = ?")
            values.append(account_data)
        if error_message is not None:
            fields.append("error_message = ?")
            values.append(error_message)
        if status == "paid":
            fields.append("paid_at = ?")
            values.append(now)
        if status == "completed":
            fields.append("completed_at = ?")
            values.append(now)

        values.append(order_id)
        query = f"UPDATE orders SET {', '.join(fields)} WHERE id = ?"
        await db.execute(query, values)

        # Update user stats on completion
        if status == "completed":
            order = await get_order(order_id)
            if order:
                await db.execute(
                    """UPDATE users SET
                         total_orders = total_orders + 1,
                         total_spent = total_spent + ?
                       WHERE user_id = ?""",
                    (order["sell_price"], order["user_id"]),
                )

        await db.commit()
    finally:
        await db.close()


async def get_user_orders(user_id: int, limit: int = 20) -> list[dict]:
    """Get orders for a specific user."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_all_orders(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Get all orders with optional status filter."""
    db = await get_db()
    try:
        if status:
            cursor = await db.execute(
                "SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (status, limit, offset),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


# ═══════════════════════════════════════
# Stats
# ═══════════════════════════════════════

async def get_stats() -> dict:
    """Get overall statistics."""
    db = await get_db()
    try:
        stats = {}

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM users")
        row = await cursor.fetchone()
        stats["total_users"] = row["cnt"] if row else 0

        cursor = await db.execute("SELECT COUNT(*) as cnt FROM orders")
        row = await cursor.fetchone()
        stats["total_orders"] = row["cnt"] if row else 0

        cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM orders WHERE status = 'completed'"
        )
        row = await cursor.fetchone()
        stats["completed_orders"] = row["cnt"] if row else 0

        cursor = await db.execute(
            "SELECT COALESCE(SUM(profit), 0) as total FROM orders WHERE status = 'completed'"
        )
        row = await cursor.fetchone()
        stats["total_profit"] = row["total"] if row else 0.0

        cursor = await db.execute(
            "SELECT COALESCE(SUM(sell_price), 0) as total FROM orders WHERE status = 'completed'"
        )
        row = await cursor.fetchone()
        stats["total_revenue"] = row["total"] if row else 0.0

        # Today stats
        today_start = int(time.time()) - (int(time.time()) % 86400)
        cursor = await db.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(profit), 0) as profit FROM orders WHERE status = 'completed' AND completed_at >= ?",
            (today_start,),
        )
        row = await cursor.fetchone()
        stats["today_orders"] = row["cnt"] if row else 0
        stats["today_profit"] = row["profit"] if row else 0.0

        return stats
    finally:
        await db.close()


# ═══════════════════════════════════════
# Ticket operations
# ═══════════════════════════════════════

async def create_ticket(user_id: int, subject: str, message: str, attachments: Optional[str] = None) -> int:
    """Create a new support ticket with initial message."""
    now = int(time.time())
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO tickets (user_id, subject, status, created_at, updated_at) VALUES (?, ?, 'open', ?, ?)",
            (user_id, subject, now, now),
        )
        ticket_id = cursor.lastrowid
        await db.execute(
            "INSERT INTO ticket_messages (ticket_id, sender, message, attachments, created_at) VALUES (?, 'user', ?, ?, ?)",
            (ticket_id, message, attachments, now),
        )
        await db.commit()
        return ticket_id
    finally:
        await db.close()


async def get_user_tickets(user_id: int) -> list[dict]:
    """Get all tickets for a user."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        )
        return [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()


async def get_ticket_detail(ticket_id: int) -> Optional[dict]:
    """Get ticket with all messages."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,))
        ticket = await cursor.fetchone()
        if not ticket:
            return None
        result = dict(ticket)
        cursor2 = await db.execute(
            "SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
            (ticket_id,),
        )
        result["messages"] = [dict(r) for r in await cursor2.fetchall()]
        return result
    finally:
        await db.close()


async def add_ticket_message(ticket_id: int, sender: str, message: str, attachments: Optional[str] = None) -> None:
    """Add a message to a ticket."""
    now = int(time.time())
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO ticket_messages (ticket_id, sender, message, attachments, created_at) VALUES (?, ?, ?, ?, ?)",
            (ticket_id, sender, message, attachments, now),
        )
        await db.execute(
            "UPDATE tickets SET updated_at = ? WHERE id = ?",
            (now, ticket_id),
        )
        await db.commit()
    finally:
        await db.close()


async def close_ticket(ticket_id: int) -> None:
    """Close a ticket."""
    db = await get_db()
    try:
        await db.execute(
            "UPDATE tickets SET status = 'closed', updated_at = ? WHERE id = ?",
            (int(time.time()), ticket_id),
        )
        await db.commit()
    finally:
        await db.close()


async def get_all_tickets() -> list[dict]:
    """Get all tickets (admin)."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM tickets ORDER BY updated_at DESC")
        return [dict(r) for r in await cursor.fetchall()]
    finally:
        await db.close()
