/**
 * Schema v1 —— ALP 的全部核心表。
 *
 * 规则：
 *  - 只增不改：新建迁移文件，别去改已经跑过的 SQL
 *  - 所有时间都是 ISO 8601 字符串（UTC）
 *  - 所有 JSON 列以 _json 结尾，存 TEXT
 */

export type Migration = {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core',
    sql: /* sql */ `
    -- ── 课程 ────────────────────────────────────────────────
    CREATE TABLE course (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      kind         TEXT NOT NULL CHECK (kind IN ('skill','academic')),
      goal         TEXT NOT NULL DEFAULT '',
      baseline     TEXT NOT NULL DEFAULT '',
      cover        TEXT NOT NULL DEFAULT '',
      -- 三种工作量度量可并存（DECISIONS D10）
      per_day_minutes INTEGER NOT NULL DEFAULT 30,
      per_day_items   INTEGER NOT NULL DEFAULT 0,
      deadline        TEXT,
      -- 记忆库开关（DECISIONS D16）
      memory_mode  TEXT NOT NULL DEFAULT 'auto' CHECK (memory_mode IN ('auto','on','off')),
      -- 讲解密度 1-5（DECISIONS D7）
      verbosity    INTEGER NOT NULL DEFAULT 3 CHECK (verbosity BETWEEN 1 AND 5),
      status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      sort_index   INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_course_status ON course(status, sort_index);

    -- ── 课时 ────────────────────────────────────────────────
    CREATE TABLE lesson (
      id          TEXT PRIMARY KEY,
      course_id   TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      title       TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      state       TEXT NOT NULL DEFAULT 'todo' CHECK (state IN ('todo','doing','review','done')),
      mastery     REAL NOT NULL DEFAULT 0 CHECK (mastery BETWEEN 0 AND 1),
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX idx_lesson_course ON lesson(course_id, order_index);

    -- ── 资料 ────────────────────────────────────────────────
    CREATE TABLE material (
      id          TEXT PRIMARY KEY,
      course_id   TEXT REFERENCES course(id) ON DELETE CASCADE,  -- NULL = 全局书库
      name        TEXT NOT NULL,
      kind        TEXT NOT NULL,                 -- pdf|docx|pptx|md|txt|xlsx|csv|json|image|web|generated
      origin      TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local','web','generated')),
      source_url  TEXT,
      file_path   TEXT,
      byte_size   INTEGER NOT NULL DEFAULT 0,
      char_count  INTEGER NOT NULL DEFAULT 0,
      parser      TEXT,                          -- markitdown|pymupdf|js-fallback|...
      degraded    INTEGER NOT NULL DEFAULT 0,    -- 1 = 走了降级解析器
      in_memory   INTEGER NOT NULL DEFAULT 1,    -- 1 = 参与索引（可单独剔除）
      status      TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','parsed','indexed','failed','excluded')),
      error       TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX idx_material_course ON material(course_id, created_at DESC);

    -- ── 分片 ────────────────────────────────────────────────
    CREATE TABLE chunk (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id  TEXT NOT NULL REFERENCES material(id) ON DELETE CASCADE,
      course_id    TEXT,
      order_index  INTEGER NOT NULL,
      text         TEXT NOT NULL,
      heading_path TEXT NOT NULL DEFAULT '',     -- 例如 "第1章 > 1.2 极限"
      page         INTEGER,
      char_count   INTEGER NOT NULL DEFAULT 0,
      token_est    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_chunk_material ON chunk(material_id, order_index);
    CREATE INDEX idx_chunk_course ON chunk(course_id);

    -- ── 教学记录 ────────────────────────────────────────────
    CREATE TABLE teaching_log (
      id             TEXT PRIMARY KEY,
      course_id      TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      lesson_id      TEXT REFERENCES lesson(id) ON DELETE SET NULL,
      started_at     TEXT NOT NULL,
      ended_at       TEXT,
      duration_sec   INTEGER NOT NULL DEFAULT 0,
      covered_json   TEXT NOT NULL DEFAULT '[]', -- 覆盖的知识点
      mastery_before REAL,
      mastery_after  REAL,
      pace_action    TEXT CHECK (pace_action IN ('faster','hold','slower')),
      pace_reason    TEXT,
      next_hint      TEXT,
      -- 疲劳信号（DECISIONS D8）
      fatigue_json   TEXT NOT NULL DEFAULT '{}',
      note           TEXT
    );
    CREATE INDEX idx_tlog_course ON teaching_log(course_id, started_at DESC);

    -- ── 每课程一条"优先阅读条目"（DECISIONS D9） ────────────
    CREATE TABLE course_memory_pin (
      course_id       TEXT PRIMARY KEY REFERENCES course(id) ON DELETE CASCADE,
      content         TEXT NOT NULL DEFAULT '',
      auto_updated_at TEXT
    );

    -- ── 问答 ────────────────────────────────────────────────
    CREATE TABLE qa_thread (
      id         TEXT PRIMARY KEY,
      course_id  TEXT REFERENCES course(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE qa_message (
      id             TEXT PRIMARY KEY,
      thread_id      TEXT NOT NULL REFERENCES qa_thread(id) ON DELETE CASCADE,
      role           TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content        TEXT NOT NULL,
      citations_json TEXT NOT NULL DEFAULT '[]',
      attach_json    TEXT NOT NULL DEFAULT '[]',
      created_at     TEXT NOT NULL
    );
    CREATE INDEX idx_qamsg_thread ON qa_message(thread_id, created_at);

    -- ── 题目与答题 ──────────────────────────────────────────
    CREATE TABLE question (
      id           TEXT PRIMARY KEY,
      course_id    TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      lesson_id    TEXT REFERENCES lesson(id) ON DELETE SET NULL,
      type         TEXT NOT NULL CHECK (type IN ('mcq','blank','short','calc')),
      stem         TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      answer       TEXT NOT NULL,
      explain      TEXT NOT NULL DEFAULT '',
      source       TEXT NOT NULL DEFAULT 'generated',
      source_ref   TEXT,
      fsrs_json    TEXT NOT NULL DEFAULT '{}',
      due_at       TEXT,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_question_course_due ON question(course_id, due_at);

    CREATE TABLE attempt (
      id           TEXT PRIMARY KEY,
      question_id  TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
      answered_at  TEXT NOT NULL,
      user_answer  TEXT NOT NULL DEFAULT '',
      correct      INTEGER NOT NULL,
      elapsed_ms   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_attempt_q ON attempt(question_id, answered_at DESC);

    -- ── 题库源（用户自定义，M6） ────────────────────────────
    CREATE TABLE question_source (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      kind          TEXT NOT NULL,          -- opentrivia|openstax|anki|custom
      url           TEXT,
      config_json   TEXT NOT NULL DEFAULT '{}',
      enabled       INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL
    );

    -- ── 设置 ────────────────────────────────────────────────
    CREATE TABLE setting (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 默认设置
    INSERT INTO setting(key, value) VALUES
      ('llm.provider',        'api'),
      ('llm.model',           'deepseek-chat'),
      ('llm.baseUrl',         'https://api.deepseek.com'),
      ('embed.provider',      'local'),
      ('embed.model',         'Xenova/bge-small-zh-v1.5'),
      ('ui.verbosity',        '3'),
      ('voice.ttsEnabled',    '0'),
      ('voice.asrEnabled',    '0'),
      ('voice.hotkey',        'F2'),
      ('demo.mode',           '0');
    `,
  },
  {
    version: 2,
    name: 'memory-index',
    sql: /* sql */ `
    -- 资料导入进度（前端要能看见"解析到哪一步"）
    ALTER TABLE material ADD COLUMN stage TEXT NOT NULL DEFAULT '';
    ALTER TABLE material ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE material ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE material ADD COLUMN hash TEXT;

    -- ── 全文索引（FTS5 trigram：对中文子串友好） ──────────────
    CREATE VIRTUAL TABLE chunk_fts USING fts5(
      text,
      heading_path,
      content='chunk',
      content_rowid='id',
      tokenize='trigram'
    );

    CREATE TRIGGER chunk_ai AFTER INSERT ON chunk BEGIN
      INSERT INTO chunk_fts(rowid, text, heading_path)
      VALUES (new.id, new.text, new.heading_path);
    END;

    CREATE TRIGGER chunk_ad AFTER DELETE ON chunk BEGIN
      INSERT INTO chunk_fts(chunk_fts, rowid, text, heading_path)
      VALUES ('delete', old.id, old.text, old.heading_path);
    END;

    CREATE TRIGGER chunk_au AFTER UPDATE ON chunk BEGIN
      INSERT INTO chunk_fts(chunk_fts, rowid, text, heading_path)
      VALUES ('delete', old.id, old.text, old.heading_path);
      INSERT INTO chunk_fts(rowid, text, heading_path)
      VALUES (new.id, new.text, new.heading_path);
    END;

    -- 索引级设置（embedding 维度变了要重建，所以记下来）
    INSERT INTO setting(key, value) VALUES
      ('embed.dims',   '512'),
      ('embed.batch',  '16'),
      ('search.topK',  '8'),
      ('search.rrfK',  '60');
    `,
  },
  {
    version: 3,
    name: 'teaching',
    sql: /* sql */ `
    -- 教学会话：一次"坐下来上课"就是一条
    CREATE TABLE teach_session (
      id            TEXT PRIMARY KEY,
      course_id     TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      lesson_id     TEXT REFERENCES lesson(id) ON DELETE SET NULL,
      started_at    TEXT NOT NULL,
      ended_at      TEXT,
      step_index    INTEGER NOT NULL DEFAULT 0,
      turn_index    INTEGER NOT NULL DEFAULT 0,
      pace          TEXT NOT NULL DEFAULT 'hold' CHECK (pace IN ('faster','hold','slower')),
      state_json    TEXT NOT NULL DEFAULT '{}',
      history_json  TEXT NOT NULL DEFAULT '[]',
      -- 行为信号：每次交互记一条，用来判断疲劳
      signals_json  TEXT NOT NULL DEFAULT '[]',
      mastery_start REAL,
      mastery_end   REAL
    );
    CREATE INDEX idx_tsess_course ON teach_session(course_id, started_at DESC);

    -- 教学设计：每节课的分步脚本（由大纲生成时产出，可人工改）
    CREATE TABLE lesson_plan (
      lesson_id  TEXT PRIMARY KEY REFERENCES lesson(id) ON DELETE CASCADE,
      steps_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    INSERT INTO setting(key, value) VALUES
      ('llm.apiKey',   ''),
      ('llm.temperature','0.6'),
      ('llm.maxTokens', '1200'),
      ('teach.dailyGoalMinutes','0');
    `,
  },
  {
    version: 4,
    name: 'student-profile-and-textbook',
    sql: /* sql */ `
    -- 学生画像：第一次进课程时访谈得到，之后可以随时改
    ALTER TABLE course ADD COLUMN familiarity INTEGER;
    ALTER TABLE course ADD COLUMN learning_style TEXT;
    ALTER TABLE course ADD COLUMN support_level TEXT;
    ALTER TABLE course ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE course ADD COLUMN onboarded_at TEXT;

    -- 专属教材：一门课一本，为学生定制
    CREATE TABLE textbook (
      id           TEXT PRIMARY KEY,
      course_id    TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      title        TEXT NOT NULL,
      subtitle     TEXT NOT NULL DEFAULT '',
      preface      TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','building','ready','failed')),
      stage        TEXT NOT NULL DEFAULT '',
      progress     INTEGER NOT NULL DEFAULT 0,
      error        TEXT,
      profile_json TEXT NOT NULL DEFAULT '{}',
      sources_json TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_textbook_course ON textbook(course_id, created_at DESC);

    CREATE TABLE textbook_chapter (
      id          TEXT PRIMARY KEY,
      textbook_id TEXT NOT NULL REFERENCES textbook(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      title       TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      content_md  TEXT NOT NULL DEFAULT '',
      goal        TEXT NOT NULL DEFAULT '',
      self_check  TEXT NOT NULL DEFAULT '',
      word_count  INTEGER NOT NULL DEFAULT 0,
      lesson_id   TEXT,
      created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_chapter_book ON textbook_chapter(textbook_id, order_index);

    -- 访谈记录（留痕，方便回看学生当初怎么说的）
    CREATE TABLE interview (
      id          TEXT PRIMARY KEY,
      course_id   TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      answers_json TEXT NOT NULL DEFAULT '[]',
      profile_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX idx_interview_course ON interview(course_id, started_at DESC);
    `,
  },
  {
    version: 5,
    name: 'chapter-teaching-and-figures',
    sql: /* sql */ `
    -- 教学可以绑定到教材的某一章（逐章讲）
    ALTER TABLE teach_session ADD COLUMN chapter_id TEXT;
    ALTER TABLE lesson_plan ADD COLUMN chapter_id TEXT;

    -- 章节配图：讲这一章时要摆出来的图
    ALTER TABLE textbook_chapter ADD COLUMN figures_json TEXT NOT NULL DEFAULT '[]';

    -- 划词标记：着重标记 / 待处理对话
    CREATE TABLE annotation (
      id           TEXT PRIMARY KEY,
      course_id    TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      source_kind  TEXT NOT NULL DEFAULT 'chapter',   -- chapter | material | qa | note
      source_id    TEXT,                              -- 章节 id / 资料 id
      text         TEXT NOT NULL,
      note         TEXT NOT NULL DEFAULT '',
      color        TEXT NOT NULL DEFAULT 'yellow',    -- yellow | green | blue
      start_offset INTEGER NOT NULL DEFAULT -1,
      end_offset   INTEGER NOT NULL DEFAULT -1,
      in_memory    INTEGER NOT NULL DEFAULT 0,        -- 1 = 已经进记忆库待处理
      digested_at  TEXT,                              -- 非空 = 已由 AI 归纳进记忆库
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_annotation_course ON annotation(course_id, created_at DESC);
    CREATE INDEX idx_annotation_source ON annotation(source_kind, source_id);

    -- 划词问答：临时问题，可以一键转成"待处理"
    ALTER TABLE qa_thread ADD COLUMN origin TEXT NOT NULL DEFAULT 'normal';  -- normal | selection
    ALTER TABLE qa_thread ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE qa_thread ADD COLUMN quote TEXT NOT NULL DEFAULT '';
    ALTER TABLE qa_thread ADD COLUMN source_ref TEXT;
    `,
  },
  {
    version: 6,
    name: 'chapter-grow',
    sql: /* sql */ `
    -- "多讲讲"：在教材某一章里就地续写一段，可折叠、有层级
    CREATE TABLE chapter_insert (
      id           TEXT PRIMARY KEY,
      chapter_id   TEXT NOT NULL REFERENCES textbook_chapter(id) ON DELETE CASCADE,
      -- 插在第几段之后（按空行分段计数）；-1 表示拿不到段落就放章末
      anchor_index INTEGER NOT NULL DEFAULT -1,
      anchor_text  TEXT NOT NULL DEFAULT '',
      title        TEXT NOT NULL DEFAULT '',
      content_md   TEXT NOT NULL,
      source_text  TEXT NOT NULL DEFAULT '',
      depth        INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX idx_insert_chapter ON chapter_insert(chapter_id, anchor_index, created_at);
    `,
  },
  {
    version: 7,
    name: 'course-options',
    sql: /* sql */ `
    -- 课程级选项：入口类型（course/book）、要不要网上找补充材料、要不要关键词与参考文档
    ALTER TABLE course ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 8,
    name: 'prompt-overrides',
    sql: /* sql */ `
    -- 用户改过的提示词。没记录就用内置默认；内置默认编译在程序里，
    -- 所以别人装这个软件，开箱效果和作者机器上完全一致。
    CREATE TABLE prompt_override (
      key        TEXT NOT NULL,
      field      TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (key, field)
    );
    `,
  },
  {
    version: 9,
    name: 'mistakes',
    sql: /* sql */ `
    -- 错题本：自习问答里"这道题我错了/没懂"，连问题带答案存下来
    CREATE TABLE mistake (
      id         TEXT PRIMARY KEY,
      course_id  TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      label      TEXT NOT NULL DEFAULT '',
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'selfstudy',
      reviewed   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_mistake_course ON mistake(course_id, created_at DESC);
    `,
  },
  {
    version: 10,
    name: 'mark-digest',
    sql: /* sql */ `
    -- 重点标记什么时候被 AI 归纳进记忆库的；NULL = 还没
    ALTER TABLE annotation ADD COLUMN digested_at TEXT;
    `,
  },
  {
    version: 11,
    name: 'chapter-stepwise',
    sql: /* sql */ `
    -- 一章一生成：规划阶段先把章节骨架建出来（pending），写完一章才置 done，失败置 failed。
    -- 老数据都是已写完的章，默认 'done' 正好对得上。
    ALTER TABLE textbook_chapter ADD COLUMN status TEXT NOT NULL DEFAULT 'done';

    -- 规划阶段整理好的资料摘要（书名 + 章节 + 片段）。原来只活在内存里，
    -- 拆成一章一个请求后每次写章都要用它，所以落库。
    ALTER TABLE textbook ADD COLUMN sources_block TEXT NOT NULL DEFAULT '';
    `,
  },
]
