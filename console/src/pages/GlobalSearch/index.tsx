import { useCallback, useState } from "react";
import {
  Button,
  Empty,
  Input,
  Spin,
  message,
} from "antd";
import {
  SearchOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
  StarOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import kbApi from "@/api/modules/kb";
import sopApi from "@/api/modules/sop";
import feedbackApi from "@/api/modules/feedback";
import styles from "./index.module.less";

interface SearchItem {
  type: "knowledge" | "sop" | "feedback";
  title: string;
  description: string;
  meta: string;
  score?: number;
}

export default function GlobalSearchPage() {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<SearchItem[]>([]);
  const navigate = useNavigate();

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      message.warning("请输入搜索内容");
      return;
    }
    setSearching(true);
    setHasSearched(true);
    try {
      // 并行搜索知识库、SOP 和评分反馈
      const [kbResults, sopRes, feedbackRes] = await Promise.allSettled([
        kbApi.search({ query, top_k: 5 }),
        sopApi.listSkills(),
        feedbackApi.list(undefined, 10),
      ]);

      const items: SearchItem[] = [];

      // 知识库结果
      if (kbResults.status === "fulfilled") {
        for (const r of kbResults.value) {
          items.push({
            type: "knowledge",
            title: r.document_title,
            description: r.chunk_content.slice(0, 200),
            meta: `score: ${r.score.toFixed(2)}`,
            score: r.score,
          });
        }
      }

      // SOP 技能结果（按名称/描述匹配）
      if (sopRes.status === "fulfilled") {
        const queryLower = query.toLowerCase();
        for (const skill of sopRes.value.skills || []) {
          if (
            skill.name.toLowerCase().includes(queryLower) ||
            (skill.description || "").toLowerCase().includes(queryLower)
          ) {
            items.push({
              type: "sop",
              title: skill.name,
              description: skill.description || "",
              meta: `${skill.nodes?.length || 0} 节点`,
            });
          }
        }
      }

      // 评分反馈结果（按评论匹配）
      if (feedbackRes.status === "fulfilled") {
        const queryLower = query.toLowerCase();
        for (const fb of feedbackRes.value.feedbacks || []) {
          if ((fb.comment || "").toLowerCase().includes(queryLower)) {
            items.push({
              type: "feedback",
              title: `评分 ${fb.rating}★`,
              description: fb.comment || "",
              meta: fb.agent_id,
            });
          }
        }
      }

      setResults(items);
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "搜索失败",
      );
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query]);

  const handleResultClick = (item: SearchItem) => {
    switch (item.type) {
      case "knowledge":
        navigate("/kb");
        break;
      case "sop":
        navigate("/sop");
        break;
      case "feedback":
        navigate("/feedback");
        break;
    }
  };

  const grouped = {
    knowledge: results.filter((r) => r.type === "knowledge"),
    sop: results.filter((r) => r.type === "sop"),
    feedback: results.filter((r) => r.type === "feedback"),
  };

  return (
    <div className={styles.searchPage}>
      <PageHeader
        current="全局搜索"
        subRow={
          <div style={{ color: "var(--sd-muted)", fontSize: 13 }}>
            同时搜索知识库文档、SOP 技能和评分反馈。
          </div>
        }
      />

      <div className={styles.searchInputRow}>
        <Input
          size="large"
          prefix={<SearchOutlined style={{ color: "var(--sd-muted)" }} />}
          placeholder="输入关键词搜索..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={handleSearch}
        />
        <Button
          size="large"
          type="primary"
          icon={<SearchOutlined />}
          loading={searching}
          onClick={handleSearch}
        >
          搜索
        </Button>
      </div>

      <Spin spinning={searching}>
        {hasSearched && results.length === 0 ? (
          <Empty description="未找到相关结果" />
        ) : results.length > 0 ? (
          <div className={styles.resultsSection}>
            {grouped.knowledge.length > 0 && (
              <div className={styles.resultGroup}>
                <div className={styles.resultGroupTitle}>
                  <DatabaseOutlined style={{ color: "#13c2c2" }} />
                  知识库
                  <span className={styles.resultCount}>
                    ({grouped.knowledge.length})
                  </span>
                </div>
                {grouped.knowledge.map((item, idx) => (
                  <div
                    key={`kb-${idx}`}
                    className={styles.resultItem}
                    onClick={() => handleResultClick(item)}
                  >
                    <div className={styles.resultItemTitle}>
                      {item.title}
                    </div>
                    <div className={styles.resultItemDesc}>
                      {item.description}
                    </div>
                    <div className={styles.resultItemMeta}>
                      <span>{item.meta}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {grouped.sop.length > 0 && (
              <div className={styles.resultGroup}>
                <div className={styles.resultGroupTitle}>
                  <ApartmentOutlined style={{ color: "#615ced" }} />
                  SOP 技能
                  <span className={styles.resultCount}>
                    ({grouped.sop.length})
                  </span>
                </div>
                {grouped.sop.map((item, idx) => (
                  <div
                    key={`sop-${idx}`}
                    className={styles.resultItem}
                    onClick={() => handleResultClick(item)}
                  >
                    <div className={styles.resultItemTitle}>
                      {item.title}
                    </div>
                    {item.description && (
                      <div className={styles.resultItemDesc}>
                        {item.description}
                      </div>
                    )}
                    <div className={styles.resultItemMeta}>
                      <span>{item.meta}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {grouped.feedback.length > 0 && (
              <div className={styles.resultGroup}>
                <div className={styles.resultGroupTitle}>
                  <StarOutlined style={{ color: "#ff9138" }} />
                  评分反馈
                  <span className={styles.resultCount}>
                    ({grouped.feedback.length})
                  </span>
                </div>
                {grouped.feedback.map((item, idx) => (
                  <div
                    key={`fb-${idx}`}
                    className={styles.resultItem}
                    onClick={() => handleResultClick(item)}
                  >
                    <div className={styles.resultItemTitle}>
                      {item.title}
                    </div>
                    {item.description && (
                      <div className={styles.resultItemDesc}>
                        {item.description}
                      </div>
                    )}
                    <div className={styles.resultItemMeta}>
                      <span>agent: {item.meta}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Spin>
    </div>
  );
}
