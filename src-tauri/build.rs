fn main() {
    // 前端资源通过 generate_context!() 在编译期嵌入二进制。
    // tauri-build 默认不会监听 frontendDist 目录的变化，
    // 需要显式声明 rerun-if-changed，否则修改 index.html / js / css 后
    // cargo 不会重新执行 build.rs，导致打包出的仍是旧前端。
    println!("cargo:rerun-if-changed=../frontend/index.html");
    println!("cargo:rerun-if-changed=../frontend/js");
    println!("cargo:rerun-if-changed=../frontend/css");

    tauri_build::build()
}
