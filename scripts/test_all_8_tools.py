"""Full integration test for all 8 case framework tools."""
import asyncio
import json
import sys
sys.path.insert(0, 'src')

from aiarb.agents.tools.case_framework_tools import (
    identify_case_type,
    generate_review_checklist,
    dual_perspective_analysis,
    legal_qa_consultation,
)
from aiarb.agents.tools.case_analysis_tools import (
    analyze_award_document,
    extract_case_materials,
    generate_case_graph,
    identify_gaps_and_advice,
)


async def run_all_tests():
    print("=" * 70)
    print("全量集成测试：8 个案件框架工具")
    print("=" * 70)

    # === Tool 1: identify_case_type ===
    print("\n[1/8] identify_case_type")
    result = await identify_case_type("朋友借款10万不还，有借条和转账记录", top_k=3)
    text = result.content[0].text
    print(f"  Output: {text[:200]}...")
    assert "民间借贷" in text or "案件类型识别结果" in text

    # === Tool 2: generate_review_checklist ===
    print("\n[2/8] generate_review_checklist")
    result = await generate_review_checklist("民间借贷", "applicant")
    text = result.content[0].text
    print(f"  Output: {text[:200]}...")
    assert "审查要点清单" in text or "要件清单" in text

    # === Tool 3: dual_perspective_analysis ===
    print("\n[3/8] dual_perspective_analysis")
    result = await dual_perspective_analysis("民间借贷", "借款10万未还，有借条")
    text = result.content[0].text
    print(f"  Output: {text[:200]}...")
    assert "双向视角分析" in text

    # === Tool 4: legal_qa_consultation ===
    print("\n[4/8] legal_qa_consultation")
    result = await legal_qa_consultation("民间借贷需要什么证据？")
    text = result.content[0].text
    print(f"  Output: {text[:200]}...")
    assert "证据" in text

    # === Tool 5: analyze_award_document ===
    print("\n[5/8] analyze_award_document")
    sample_award = """
    仲裁裁决书
    (2023)沪仲字第123号
    申请人：张三，男，1980年5月10日出生，汉族
    被申请人：李四，男，1975年8月15日出生，汉族
    案由：民间借贷纠纷

    查明：2022年3月1日，被申请人向申请人借款100万元，双方签订借款合同，
    约定年利率10%，借款期限一年。借款到期后，被申请人未按约归还借款本息。

    仲裁庭认为：《中华人民共和国民法典》第六百六十七条规定，借款合同是
    借款人向贷款人借款，到期返还借款并支付利息的合同。

    裁决如下：
    一、被申请人李四应于本裁决生效之日起十日内返还申请人张三借款本金100万元；
    二、被申请人李四应于本裁决生效之日起十日内支付申请人张三借款利息。
    """
    result = await analyze_award_document(sample_award)
    text = result.content[0].text
    print(f"  Output: {text[:200]}...")
    assert "裁决文书分析报告" in text
    assert "申请人" in text

    # === Tool 6: extract_case_materials ===
    print("\n[6/8] extract_case_materials")
    sample_materials = """
    申请人：张三，男，汉族，1980年5月10日出生
    被申请人：李四公司
    借款合同
    2023年3月15日，申请人向被申请人借款100000元，年利率10%。
    2024年3月15日借款到期，被申请人未归还。
    """
    result = await extract_case_materials(sample_materials)
    text = result.content[0].text
    print(f"  Output: {text[:200]}...")
    assert "案件材料关键信息提取报告" in text
    assert "张三" in text or "当事人" in text

    # === Tool 7: generate_case_graph ===
    print("\n[7/8] generate_case_graph (3 types)")
    # Knowledge graph
    result = await generate_case_graph("民间借贷", "knowledge_graph")
    text = result.content[0].text
    print(f"  knowledge_graph: {text[:100]}...")
    assert "graph TD" in text

    # Mindmap
    result = await generate_case_graph("民间借贷", "mindmap")
    text = result.content[0].text
    print(f"  mindmap: {text[:100]}...")
    assert "mindmap" in text

    # Flowchart
    result = await generate_case_graph("民间借贷", "flowchart")
    text = result.content[0].text
    print(f"  flowchart: {text[:100]}...")
    assert "flowchart TD" in text

    # === Tool 8: identify_gaps_and_advice ===
    print("\n[8/8] identify_gaps_and_advice")
    existing = json.dumps([{"name": "借条"}, {"name": "转账记录"}], ensure_ascii=False)
    result = await identify_gaps_and_advice("民间借贷", existing, "applicant")
    text = result.content[0].text
    print(f"  Output: {text[:200]}...")
    assert "缺失要素分析" in text

    # === Verify all tools registered ===
    print("\n[Registration] Checking tool registry...")
    from aiarb.agents.tools import discover_builtin_tool_funcs
    all_tools = discover_builtin_tool_funcs()
    tool_names = {t.__name__ for t in all_tools}
    expected = {
        "identify_case_type",
        "generate_review_checklist",
        "dual_perspective_analysis",
        "legal_qa_consultation",
        "analyze_award_document",
        "extract_case_materials",
        "generate_case_graph",
        "identify_gaps_and_advice",
    }
    found = expected & tool_names
    missing = expected - tool_names
    print(f"  Found: {len(found)}/{len(expected)}")
    if missing:
        print(f"  MISSING: {missing}")
        return False

    print("\n" + "=" * 70)
    print("✅ ALL 8 TOOLS PASSED INTEGRATION TEST")
    print("=" * 70)
    return True


if __name__ == "__main__":
    success = asyncio.run(run_all_tests())
    sys.exit(0 if success else 1)
