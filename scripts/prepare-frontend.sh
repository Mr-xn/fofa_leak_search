#!/bin/bash
# 准备前端资源到 dist 目录（Tauri 构建前调用）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
cp "$PROJECT_ROOT/index.html" "$DIST_DIR/"
cp -r "$PROJECT_ROOT/js" "$DIST_DIR/"
cp -r "$PROJECT_ROOT/src-tauri/icons" "$DIST_DIR/" 2>/dev/null || true
echo "[prepare-frontend] Copied web assets to $DIST_DIR"
