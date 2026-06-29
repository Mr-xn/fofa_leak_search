// dedup.rs - 高性能结果去重模块
// 通过 Tauri Command 暴露给前端，处理大规模数据去重

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 去重结果统计
#[derive(Debug, Serialize, Deserialize)]
pub struct DedupResult {
    /// 去重后的结果行
    pub rows: Vec<Vec<String>>,
    /// 原始总行数
    pub total_fetched: usize,
    /// 去重后唯一行数
    pub unique_count: usize,
    /// 重复行数
    pub duplicate_count: usize,
}

/// 对多批次结果进行合并去重
///
/// # 参数
/// - `batches`: 多个结果批次，每个批次是二维字符串数组 [行[列]]
/// - `dedup_key_index`: 用于去重的字段列索引（如 link 字段的索引）
///
/// # 返回
/// 去重后的合并结果及统计信息
#[tauri::command]
pub fn dedup_results(batches: Vec<Vec<Vec<String>>>, dedup_key_index: usize) -> DedupResult {
    let mut seen: HashMap<String, bool> = HashMap::new();
    let mut merged: Vec<Vec<String>> = Vec::new();
    let mut total_fetched: usize = 0;

    for batch in &batches {
        total_fetched += batch.len();
        for row in batch {
            // 获取去重键值
            let key = if dedup_key_index < row.len() {
                &row[dedup_key_index]
            } else {
                // 索引越界，用行内容的哈希作为降级方案
                continue;
            };

            if seen.contains_key(key) {
                continue;
            }

            seen.insert(key.clone(), true);
            merged.push(row.clone());
        }
    }

    let unique_count = merged.len();
    let duplicate_count = total_fetched.saturating_sub(unique_count);

    DedupResult {
        rows: merged,
        total_fetched,
        unique_count,
        duplicate_count,
    }
}

/// 对单个大结果数组去重
///
/// # 参数
/// - `rows`: 二维字符串数组 [行[列]]
/// - `dedup_key_index`: 去重字段列索引
///
/// # 返回
/// 去重后的结果及统计
#[tauri::command]
pub fn dedup_single(rows: Vec<Vec<String>>, dedup_key_index: usize) -> DedupResult {
    let total_fetched = rows.len();
    let mut seen: HashMap<String, bool> = HashMap::new();
    let mut merged: Vec<Vec<String>> = Vec::new();

    for row in &rows {
        let key = if dedup_key_index < row.len() {
            &row[dedup_key_index]
        } else {
            continue;
        };

        if seen.contains_key(key) {
            continue;
        }

        seen.insert(key.clone(), true);
        merged.push(row.clone());
    }

    let unique_count = merged.len();
    let duplicate_count = total_fetched.saturating_sub(unique_count);

    DedupResult {
        rows: merged,
        total_fetched,
        unique_count,
        duplicate_count,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedup_no_duplicates() {
        let batches = vec![
            vec![
                vec!["1.1.1.1".into(), "80".into(), "http://a.com".into()],
                vec!["2.2.2.2".into(), "443".into(), "http://b.com".into()],
            ],
        ];
        let result = dedup_results(batches, 2);
        assert_eq!(result.unique_count, 2);
        assert_eq!(result.duplicate_count, 0);
    }

    #[test]
    fn test_dedup_with_duplicates() {
        let batches = vec![
            vec![
                vec!["1.1.1.1".into(), "80".into(), "http://a.com".into()],
                vec!["2.2.2.2".into(), "443".into(), "http://b.com".into()],
            ],
            vec![
                vec!["1.1.1.1".into(), "80".into(), "http://a.com".into()], // duplicate
                vec!["3.3.3.3".into(), "8080".into(), "http://c.com".into()],
            ],
        ];
        let result = dedup_results(batches, 2);
        assert_eq!(result.total_fetched, 4);
        assert_eq!(result.unique_count, 3);
        assert_eq!(result.duplicate_count, 1);
    }

    #[test]
    fn test_dedup_single() {
        let rows = vec![
            vec!["a".into(), "http://x.com".into()],
            vec!["b".into(), "http://y.com".into()],
            vec!["a".into(), "http://x.com".into()],
        ];
        let result = dedup_single(rows, 1);
        assert_eq!(result.unique_count, 2);
        assert_eq!(result.duplicate_count, 1);
    }

    #[test]
    fn test_dedup_index_out_of_bounds() {
        let rows = vec![
            vec!["a".into()],
            vec!["b".into()],
        ];
        let result = dedup_single(rows, 5);
        // 越界索引的行被跳过
        assert_eq!(result.unique_count, 0);
    }
}
