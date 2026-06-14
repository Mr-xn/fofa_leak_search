#!/bin/bash
# FOFA Leak Search - Tauri 桌面应用构建脚本
# 纯 Rust 架构，无需 Python/PyInstaller
#
# 用法:
#   ./scripts/build-tauri.sh          # 构建 Tauri 应用
#   ./scripts/build-tauri.sh --dev    # 开发模式启动

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================="
echo "  FOFA Leak Search - Tauri Build"
echo "=========================================="

# 检查依赖
check_deps() {
    local missing=()
    command -v rustc &> /dev/null || missing+=("Rust")
    command -v node &> /dev/null || missing+=("Node.js")

    if [ ${#missing[@]} -gt 0 ]; then
        echo "[Error] Missing dependencies: ${missing[*]}"
        echo "Please install them first."
        exit 1
    fi
}

# 安装 npm 依赖
install_deps() {
    echo ""
    echo "[Step 1/2] Installing npm dependencies..."
    echo "------------------------------------------"
    cd "$PROJECT_ROOT"
    npm install
    echo "[npm] Dependencies installed."
}

# 构建 Tauri 应用
build_tauri() {
    echo ""
    echo "[Step 2/2] Building Tauri application..."
    echo "------------------------------------------"
    cd "$PROJECT_ROOT"
    npm run tauri build
    echo ""
    echo "=========================================="
    echo "  Build complete!"
    echo "  Output: src-tauri/target/release/bundle/"
    echo "=========================================="
}

# 开发模式
dev_mode() {
    echo ""
    echo "[Dev] Starting in development mode..."
    echo "  Tauri window loads from: http://localhost:8000"
    echo ""

    cd "$PROJECT_ROOT"

    # 后端启动 Python server（仅开发模式用，提供静态文件 + API 代理）
    echo "[Dev] Starting Python dev server on port 8000..."
    python3 server.py &
    PYTHON_PID=$!

    sleep 1

    # 启动 Tauri 开发模式
    echo "[Dev] Starting Tauri dev mode..."
    npm run tauri dev

    # 清理
    kill $PYTHON_PID 2>/dev/null || true
}

# 主流程
main() {
    check_deps

    case "${1:-}" in
        --dev)
            dev_mode
            ;;
        *)
            install_deps
            build_tauri
            ;;
    esac
}

main "$@"
