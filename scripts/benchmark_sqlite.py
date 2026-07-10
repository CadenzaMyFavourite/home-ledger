"""Repeatable 50k-row SQLite query benchmark for HomeLedger's transaction list."""

from __future__ import annotations

import datetime as dt
import math
import pathlib
import sqlite3
import statistics
import tempfile
import time


ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "src-tauri" / "migrations"
ROW_COUNT = 50_000
ITERATIONS = 60
P95_BUDGET_MS = 250.0


def percentile_95(values: list[float]) -> float:
    return sorted(values)[max(0, math.ceil(len(values) * 0.95) - 1)]


def measure(connection: sqlite3.Connection, sql: str, parameters: tuple[object, ...]) -> tuple[float, float]:
    connection.execute(sql, parameters).fetchall()
    samples: list[float] = []
    for _ in range(ITERATIONS):
        started = time.perf_counter()
        connection.execute(sql, parameters).fetchall()
        samples.append((time.perf_counter() - started) * 1_000)
    return statistics.median(samples), percentile_95(samples)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="home-ledger-benchmark-") as temporary_directory:
        database_path = pathlib.Path(temporary_directory) / "benchmark.sqlite3"
        connection = sqlite3.connect(database_path)
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = MEMORY")
        connection.execute("PRAGMA synchronous = OFF")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            connection.executescript(migration.read_text(encoding="utf-8"))

        base_date = dt.date(2022, 1, 1)
        member_id = "00000000-0000-7000-8000-000000000001"
        payment_method_id = "20000000-0000-7000-8000-000000000001"
        grocery_id = "10000000-0000-7000-8000-000000000101"
        medical_id = "10000000-0000-7000-8000-000000000006"
        inserted_at = "2026-07-03T12:00:00Z"
        rows = []
        for index in range(ROW_COUNT):
            transaction_date = (base_date + dt.timedelta(days=index % 1645)).isoformat()
            amount_minor = 100 + (index * 7919) % 500_000
            category_id = medical_id if index % 11 == 0 else grocery_id
            status = "planned" if index % 17 == 0 else "completed"
            reporting_amount = amount_minor if status == "completed" else None
            reporting_currency = "CAD" if status == "completed" else None
            rows.append(
                (
                    f"benchmark-{index:05d}",
                    transaction_date,
                    "expense",
                    status,
                    amount_minor,
                    reporting_amount,
                    reporting_currency,
                    category_id,
                    payment_method_id,
                    member_id,
                    f"Merchant {index % 250}",
                    "benchmark fixture",
                    inserted_at,
                    inserted_at,
                )
            )
        insert_started = time.perf_counter()
        connection.executemany(
            """
            INSERT INTO transactions(
                id, transaction_date, transaction_type, status, amount_minor, currency_code,
                reporting_amount_minor, reporting_currency_code, category_id, payment_method_id,
                household_member_id, merchant, note, origin, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'CAD', ?, ?, ?, ?, ?, ?, ?, 'manual', 1, ?, ?)
            """,
            rows,
        )
        connection.commit()
        insert_seconds = time.perf_counter() - insert_started

        default_query = """
            SELECT t.id, t.transaction_date, t.amount_minor, c.name, source.display_name
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            LEFT JOIN payment_methods source ON source.id = t.payment_method_id
            WHERE t.deleted_at IS NULL
            ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
            LIMIT 50 OFFSET 0
        """
        complex_query = """
            SELECT t.id, t.transaction_date, t.amount_minor, c.name
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id
            WHERE t.deleted_at IS NULL
              AND t.status = 'completed'
              AND t.transaction_type = 'expense'
              AND t.transaction_date >= ?
              AND t.transaction_date <= ?
              AND t.amount_minor >= ?
              AND t.amount_minor <= ?
              AND t.category_id = ?
            ORDER BY t.amount_minor DESC, t.transaction_date DESC, t.id DESC
            LIMIT 50 OFFSET 0
        """
        default_median, default_p95 = measure(connection, default_query, ())
        complex_median, complex_p95 = measure(
            connection,
            complex_query,
            ("2025-01-01", "2026-07-03", 10_000, 400_000, medical_id),
        )
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        assert integrity == ("ok",), integrity
        assert default_p95 < P95_BUDGET_MS, f"default query P95 {default_p95:.2f}ms exceeds budget"
        assert complex_p95 < P95_BUDGET_MS, f"complex query P95 {complex_p95:.2f}ms exceeds budget"
        connection.close()
        print(
            f"SQLite {ROW_COUNT:,} rows inserted in {insert_seconds:.2f}s; "
            f"default median/P95={default_median:.2f}/{default_p95:.2f}ms; "
            f"complex median/P95={complex_median:.2f}/{complex_p95:.2f}ms"
        )


if __name__ == "__main__":
    main()
