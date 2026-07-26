#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import re
import logging
from typing import Dict, Any, Optional, List, Tuple, Union
from pathlib import Path
from datetime import datetime

from . import LocalComponent, ParseResult

# 配置日志
logger = logging.getLogger(__name__)


class DocFillComponent(LocalComponent):
    """
    文档回填组件
    
    该组件负责将结构化数据填充到文档模板中，支持多种文档格式的回填操作。
    特别适用于商事仲裁场景中的裁决书、通知书、函件等文档的自动化生成。
    
    主要功能：
    1. 基于模板的文档回填
    2. 字段映射和转换
    3. 条件内容生成
    4. 多格式输出支持
    5. 数据验证和错误处理
    """
    
    # 组件元数据
    component_name = "document_fill"
    component_version = "1.0.0"
    component_author = "AI Arbitration System Team"
    component_description = "文档回填组件 - 基于模板的文档自动化生成"
    
    # 依赖配置 - 本地组件通常没有外部依赖
    dependencies = []
    optional_dependencies = []
    
    def __init__(self):
        """初始化文档回填组件"""
        super().__init__()
        self.templates = {}
        self.field_mappings = {}
        self.default_styles = {
            'font_family': 'SimSun',
            'font_size': 12,
            'line_spacing': 1.5,
            'alignment': 'justify'
        }
    
    def initialize(self) -> bool:
        """
        初始化文档回填组件
        
        Returns:
            bool: 初始化成功返回True，否则返回False
        """
        try:
            logger.info("正在初始化文档回填组件...")
            
            # 加载默认模板
            self._load_default_templates()
            
            # 验证组件功能
            test_result = self._test_basic_functionality()
            if not test_result:
                logger.error("文档回填组件基础功能测试失败")
                return False
            
            logger.info("文档回填组件初始化成功")
            return True
            
        except Exception as e:
            logger.error(f"文档回填组件初始化失败: {e}")
            return False
    
    def _load_default_templates(self):
        """加载默认的文档模板"""
        # 商事仲裁常用模板
        self.templates = {
            'arbitration_award': {
                'name': '仲裁裁决书模板',
                'description': '标准商事仲裁裁决书格式',
                'template': """
                仲裁裁决书
                
                案号：{{case_number}}
                
                申请人：{{applicant_name}}
                地址：{{applicant_address}}
                法定代表人：{{applicant_legal_representative}}
                
                被申请人：{{respondent_name}}
                地址：{{respondent_address}}
                法定代表人：{{respondent_legal_representative}}
                
                仲裁请求：
                {{arbitration_requests}}
                
                事实和理由：
                {{facts_and_reasons}}
                
                仲裁庭意见：
                {{tribunal_opinion}}
                
                裁决如下：
                {{award_content}}
                
                本裁决为终局裁决，自作出之日起发生法律效力。
                
                仲裁员：{{arbitrator_name}}
                作出日期：{{award_date}}
                """,
                'fields': [
                    'case_number', 'applicant_name', 'applicant_address', 
                    'applicant_legal_representative', 'respondent_name',
                    'respondent_address', 'respondent_legal_representative',
                    'arbitration_requests', 'facts_and_reasons',
                    'tribunal_opinion', 'award_content', 'arbitrator_name', 'award_date'
                ]
            },
            
            'arbitration_notice': {
                'name': '仲裁通知书模板',
                'description': '仲裁程序通知书',
                'template': """
                仲裁通知书
                
                {{recipient_name}}
                {{recipient_address}}
                
                根据《仲裁规则》有关规定，现就{{case_type}}一案通知如下：
                
                案由：{{case_subject}}
                案号：{{case_number}}
                仲裁请求：{{requests}}
                
                {{notice_content}}
                
                特此通知。
                
                {{notice_date}}
                {{organization_name}}
                """,
                'fields': [
                    'recipient_name', 'recipient_address', 'case_type',
                    'case_subject', 'case_number', 'requests',
                    'notice_content', 'notice_date', 'organization_name'
                ]
            },
            
            'evidence_request': {
                'name': '证据提交通知模板',
                'description': '要求当事人提交证据的通知',
                'template': """
                证据提交通知书
                
                致：{{party_name}}
                
                案号：{{case_number}}
                案件名称：{{case_name}}
                
                根据仲裁程序规则，请在{{deadline}}前提交以下证据材料：
                
                {{evidence_list}}
                
                逾期未提交的，将承担相应法律后果。
                
                {{notice_date}}
                {{organization_name}}
                """,
                'fields': [
                    'party_name', 'case_number', 'case_name',
                    'deadline', 'evidence_list', 'notice_date', 'organization_name'
                ]
            }
        }
        
        # 字段映射规则
        self.field_mappings = {
            'date_formats': {
                'yyyy-mm-dd': '%Y-%m-%d',
                'yyyy年mm月dd日': '%Y年%m月%d日',
                'mm/dd/yyyy': '%m/%d/%Y'
            },
            'number_formats': {
                'currency': '￥{:.2f}',
                'percentage': '{:.2%}',
                'number': '{:,}'
            },
            'boolean_mappings': {
                True: '是',
                False: '否'
            }
        }
    
    def _test_basic_functionality(self) -> bool:
        """测试基础功能是否正常"""
        try:
            # 简单的模板测试
            test_template = "Hello {{name}}! Your score is {{score}}."
            test_data = {'name': 'World', 'score': 95}
            
            result = self._fill_template(test_template, test_data)
            expected = "Hello World! Your score is 95."
            
            return result == expected
            
        except Exception as e:
            logger.error(f"基础功能测试失败: {e}")
            return False
    
    def parse(self,
              file_path: str,
              fill_data: Optional[Dict[str, Any]] = None,
              template_type: str = None,
              output_format: str = 'text',
              custom_styles: Optional[Dict] = None,
              **kwargs) -> ParseResult:
        """
        执行文档回填处理
        
        Args:
            file_path: 模板文件路径
            fill_data: 填充数据
            template_type: 模板类型
            output_format: 输出格式 (text, json, html)
            custom_styles: 自定义样式
            **kwargs: 额外参数
            
        Returns:
            ParseResult: 回填处理结果
        """
        try:
            file_path_obj = Path(file_path)
            
            # 验证输入参数
            if not file_path_obj.exists():
                return ParseResult(
                    success=False,
                    data=None,
                    error=f"模板文件不存在: {file_path}",
                    metadata={'file_path': file_path}
                )
            
            if fill_data is None:
                return ParseResult(
                    success=False,
                    data=None,
                    error="填充数据不能为空",
                    metadata={'file_path': file_path}
                )
            
            # 读取模板文件
            template_content = self._read_template_file(file_path, template_type)
            if template_content is None:
                return ParseResult(
                    success=False,
                    data=None,
                    error=f"无法读取模板文件: {file_path}",
                    metadata={'file_path': file_path, 'template_type': template_type}
                )
            
            # 执行数据验证
            validation_result = self._validate_fill_data(fill_data, template_content)
            if not validation_result['valid']:
                return ParseResult(
                    success=False,
                    data=None,
                    error=f"数据验证失败: {validation_result['errors']}",
                    metadata={
                        'file_path': file_path,
                        'validation_errors': validation_result['errors'],
                        'missing_fields': validation_result.get('missing_fields', [])
                    }
                )
            
            # 执行文档回填
            filled_content = self._fill_template(template_content, fill_data)
            
            # 应用样式（如果需要）
            if custom_styles:
                filled_content = self._apply_styles(filled_content, custom_styles)
            
            # 格式化输出
            formatted_content = self._format_output(filled_content, output_format)
            
            # 创建结果数据
            result_data = {
                'original_template': template_content if kwargs.get('keep_template', False) else None,
                'filled_content': formatted_content,
                'fill_data': fill_data if kwargs.get('keep_data', False) else None,
                'output_format': output_format,
                'template_source': file_path,
                'template_type': template_type
            }
            
            # 保存结果文件（如果指定了输出路径）
            output_path = kwargs.get('output_path')
            if output_path:
                save_success = self._save_output_file(output_path, formatted_content, output_format)
                if save_success:
                    result_data['output_path'] = output_path
                else:
                    return ParseResult(
                        success=False,
                        data=None,
                        error=f"无法保存输出文件: {output_path}",
                        metadata={'file_path': file_path}
                    )
            
            # 生成回填报告
            fill_report = {
                'data_fields_used': list(fill_data.keys()),
                'missing_fields_filled': [],  # 实际使用默认值填充的字段
                'validation_warnings': validation_result.get('warnings', []),
                'processing_time': None  # 可在调用处计算
            }
            
            return ParseResult(
                success=True,
                data=result_data,
                metadata={
                    'file_path': file_path,
                    'template_type': template_type,
                    'output_format': output_format,
                    'data_fields_count': len(fill_data),
                    'fill_report': fill_report
                }
            )
            
        except Exception as e:
            logger.error(f"文档回填处理失败: {e}", exc_info=True)
            return ParseResult(
                success=False,
                data=None,
                error=f"回填处理失败: {e}",
                metadata={'file_path': file_path}
            )
    
    def _read_template_file(self, file_path: str, template_type: str = None) -> Optional[str]:
        """
        读取模板文件
        
        Args:
            file_path: 文件路径
            template_type: 模板类型
            
        Returns:
            Optional[str]: 模板内容，读取失败返回None
        """
        try:
            path_obj = Path(file_path)
            
            # 如果是已知的模板类型，从内存模板加载
            if template_type and template_type in self.templates:
                return self.templates[template_type]['template']
            
            # 否则从文件读取
            file_ext = path_obj.suffix.lower()
            
            if file_ext == '.txt':
                with open(file_path, 'r', encoding='utf-8') as f:
                    return f.read()
            
            elif file_ext == '.json':
                with open(file_path, 'r', encoding='utf-8') as f:
                    template_json = json.load(f)
                return template_json.get('template', '')
            
            else:
                # 尝试按文本文件读取
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    return f.read()
                    
        except Exception as e:
            logger.error(f"读取模板文件失败: {e}")
            return None
    
    def _validate_fill_data(self, fill_data: Dict[str, Any], template_content: str) -> Dict[str, Any]:
        """
        验证填充数据
        
        Args:
            fill_data: 填充数据
            template_content: 模板内容
            
        Returns:
            Dict[str, Any]: 验证结果
        """
        result = {
            'valid': True,
            'errors': [],
            'warnings': [],
            'missing_fields': []
        }
        
        try:
            # 提取模板中的字段
            field_pattern = r'\\{\\{([^}]+)\\}\\}'
            required_fields = re.findall(field_pattern, template_content)
            
            # 清理字段名（去除空格）
            required_fields = [field.strip() for field in required_fields]
            
            # 检查必填字段
            missing_fields = []
            for field in required_fields:
                if field not in fill_data or fill_data[field] is None:
                    missing_fields.append(field)
            
            if missing_fields:
                result['valid'] = False
                result['errors'].append(f"缺少必填字段: {', '.join(missing_fields)}")
                result['missing_fields'] = missing_fields
            
            # 检查数据类型和格式
            type_warnings = []
            for field, value in fill_data.items():
                # 检查日期格式
                if isinstance(value, str) and self._is_date_field(field):
                    if not self._validate_date_format(value):
                        type_warnings.append(f"字段 '{field}' 的日期格式可能有误: {value}")
                
                # 检查数字格式
                elif isinstance(value, str) and self._is_number_field(field):
                    if not self._validate_number_format(value):
                        type_warnings.append(f"字段 '{field}' 的数字格式可能有误: {value}")
                
                # 检查长度限制
                elif isinstance(value, str) and len(value) > 1000:
                    type_warnings.append(f"字段 '{field}' 的值过长 ({len(value)} 字符)")
            
            result['warnings'] = type_warnings
            
        except Exception as e:
            result['valid'] = False
            result['errors'].append(f"数据验证过程出错: {e}")
            
        return result
    
    def _fill_template(self, template: str, fill_data: Dict[str, Any]) -> str:
        """
        填充模板
        
        Args:
            template: 模板内容
            fill_data: 填充数据
            
        Returns:
            str: 填充后的内容
        """
        try:
            result = template
            
            # 简单的 {{field}} 替换
            for key, value in fill_data.items():
                placeholder = "{{" + key + "}}"
                # 处理不同数据类型
                if isinstance(value, (list, tuple)):
                    # 列表转换为逗号分隔的字符串
                    formatted_value = ', '.join(str(v) for v in value)
                elif isinstance(value, dict):
                    # 字典转换为格式化的字符串
                    formatted_value = ', '.join(f"{k}: {v}" for k, v in value.items())
                elif isinstance(value, bool):
                    # 布尔值转换为中文
                    formatted_value = self.field_mappings['boolean_mappings'].get(value, str(value))
                elif isinstance(value, (int, float)):
                    # 数字处理
                    formatted_value = str(value)
                elif isinstance(value, datetime):
                    # 日期时间格式化
                    formatted_value = value.strftime('%Y年%m月%d日')
                else:
                    formatted_value = str(value) if value is not None else ''
                
                result = result.replace(placeholder, formatted_value)
            
            return result
            
        except Exception as e:
            logger.error(f"模板填充失败: {e}")
            return template
    
    def _is_date_field(self, field_name: str) -> bool:
        """
        检查字段是否为日期类型
        
        Args:
            field_name: 字段名
            
        Returns:
            bool: 是日期字段返回True，否则返回False
        """
        date_indicators = ['date', 'time', '日期', '时间', '日', '年', '月']
        return any(indicator in field_name.lower() for indicator in date_indicators)
    
    def _is_number_field(self, field_name: str) -> bool:
        """
        检查字段是否为数字类型
        
        Args:
            field_name: 字段名
            
        Returns:
            bool: 是数字字段返回True，否则返回False
        """
        number_indicators = ['amount', 'number', 'count', 'num', '金额', '数量', '号', '数额']
        return any(indicator in field_name.lower() for indicator in number_indicators)
    
    def _validate_date_format(self, date_str: str) -> bool:
        """
        验证日期格式
        
        Args:
            date_str: 日期字符串
            
        Returns:
            bool: 格式正确返回True，否则返回False
        """
        date_patterns = [
            r'\\d{4}-\\d{2}-\\d{2}',
            r'\\d{4}年\\d{2}月\\d{2}日',
            r'\\d{2}/\\d{2}/\\d{4}',
            r'\\d{4}/\\d{2}/\\d{2}'
        ]
        
        for pattern in date_patterns:
            if re.match(pattern, date_str):
                return True
        return False
    
    def _validate_number_format(self, number_str: str) -> bool:
        """
        验证数字格式
        
        Args:
            number_str: 数字字符串
            
        Returns:
            bool: 格式正确返回True，否则返回False
        """
        number_pattern = r'^\\d+(\\.\\d+)?$'
        return bool(re.match(number_pattern, number_str))
    
    def _format_output(self, content: str, output_format: str) -> str:
        """
        格式化输出内容
        
        Args:
            content: 内容
            output_format: 输出格式
            
        Returns:
            str: 格式化后的内容
        """
        try:
            if output_format == 'html':
                # 转换为HTML格式
                content_html = content.replace('\n', '<br>')
                html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>文档生成结果</title>
    <style>
        body {{ font-family: 'SimSun', Arial, sans-serif; line-height: 1.5; }}
        .document {{ margin: 20px; padding: 20px; border: 1px solid #ccc; }}
    </style>
</head>
<body>
    <div class="document">
        {content_html}
    </div>
</body>
</html>
"""
                return html_content
            
            elif output_format == 'json':
                # 转换为JSON格式
                json_content = {
                    'document': content,
                    'generated_at': datetime.now().isoformat(),
                    'format': 'text'
                }
                return json.dumps(json_content, ensure_ascii=False, indent=2)
            
            else:
                # 默认文本格式
                return content
                
        except Exception as e:
            logger.error(f"格式化输出失败: {e}")
            return content
    
    def _apply_styles(self, content: str, styles: Dict[str, Any]) -> str:
        """
        应用样式到内容
        
        Args:
            content: 内容
            styles: 样式配置
            
        Returns:
            str: 应用样式后的内容
        """
        try:
            # 简单的样式应用（主要用于HTML格式）
            if styles.get('font_family'):
                content = f"<!-- Font: {styles['font_family']} -->\n{content}"
            
            if styles.get('font_size'):
                content = f"<!-- Font Size: {styles['font_size']} -->\n{content}"
            
            return content
            
        except Exception as e:
            logger.error(f"应用样式失败: {e}")
            return content
    
    def _save_output_file(self, file_path: str, content: str, output_format: str) -> bool:
        """
        保存输出文件
        
        Args:
            file_path: 文件路径
            content: 内容
            output_format: 输出格式
            
        Returns:
            bool: 保存成功返回True，否则返回False
        """
        try:
            path_obj = Path(file_path)
            path_obj.parent.mkdir(parents=True, exist_ok=True)
            
            # 根据格式选择编码和写入方式
            if output_format == 'json':
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(content)
            else:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(content)
            
            return True
            
        except Exception as e:
            logger.error(f"保存输出文件失败: {e}")
            return False
    
    def check_dependencies(self) -> List[str]:
        """
        检查依赖项
        
        Returns:
            List[str]: 缺失的依赖项列表
        """
        missing_dependencies = []
        
        # 文档回填组件主要依赖Python标准库
        # 检查可能需要的标准库
        try:
            import json
        except ImportError:
            missing_dependencies.append("json")
        
        try:
            import re
        except ImportError:
            missing_dependencies.append("re")
        
        try:
            from datetime import datetime
        except ImportError:
            missing_dependencies.append("datetime")
        
        return missing_dependencies
    
    def get_capabilities(self) -> Dict[str, Any]:
        """
        获取组件能力信息
        
        Returns:
            Dict[str, Any]: 组件能力描述
        """
        return {
            'component_type': 'local',
            'name': self.component_name,
            'version': self.component_version,
            'description': self.component_description,
            'supported_file_types': ['.txt', '.json', '.html'],
            'supported_output_formats': ['text', 'html', 'json'],
            'template_types': list(self.templates.keys()),
            'features': [
                'template_based_fill',
                'data_validation',
                'conditional_content_generation',
                'multiple_output_formats',
                'style_application',
                'field_mapping_and_conversion'
            ],
            'performance_characteristics': {
                'speed': 'high',  # 文本处理速度快
                'memory_usage': 'low',
                'gpu_required': False,
                'network_required': False
            },
            'limitations': [
                'limited_to_text_based_templates',
                'no_advanced_formatting_support',
                'simple_field_substitution_only',
                'no_database_integration'
            ]
        }
    
    @classmethod
    def get_installation_guide(cls) -> Dict[str, str]:
        """
        获取安装指南
        
        Returns:
            Dict[str, str]: 安装指南信息
        """
        return {
            'description': '该组件使用Python标准库进行文档回填，无需额外安装依赖',
            'system_requirements': 'Python 3.7+，支持中文编码',
            'installation_steps': [
                '将组件文件放置在组件目录中',
                '在组件管理器中注册组件',
                '初始化组件完成配置',
                '准备文档模板和填充数据'
            ],
            'dependency_notes': '如果需要使用更高级的文档格式支持，建议安装python-docx, openpyxl等库'
        }


# 创建组件实例
doc_fill_component = DocFillComponent()

if __name__ == "__main__":
    # 测试代码
    print("测试文档回填组件...")
    
    # 创建测试数据
    test_data = {
        'case_number': 'ZC20230001',
        'applicant_name': '张三',
        'applicant_address': '北京市朝阳区',
        'respondent_name': '李四',
        'respondent_address': '上海市浦东新区',
        'arbitrator_name': '王仲裁',
        'award_date': datetime.now()
    }
    
    # 测试模板回填
    result = doc_fill_component.parse(
        file_path='test_template.txt',
        fill_data=test_data,
        template_type='arbitration_award'
    )
    
    if result.success:
        print("文档回填成功！")
        print(f"使用字段数: {result.metadata['data_fields_count']}")
        print("回填结果预览:")
        print(result.data['filled_content'][:200] + "..." if len(result.data['filled_content']) > 200 else result.data['filled_content'])
    else:
        print(f"文档回填失败: {result.error}")
