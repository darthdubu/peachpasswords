"""End-to-end training pipeline."""

import subprocess
import sys
import shutil
from pathlib import Path


def run_command(cmd: list[str], cwd: Path | None = None):
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
        sys.exit(1)
    print(result.stdout)
    return result


def main():
    base_dir = Path(__file__).parent.parent

    print("=== Peach Form Detection Model Training Pipeline ===\n")

    print("Step 1: Building dataset...")
    run_command([sys.executable, "src/dataset.py"], cwd=base_dir)

    print("\nStep 2: Training model...")
    run_command([sys.executable, "src/train.py"], cwd=base_dir)

    print("\nStep 3: Copying model to extension...")
    model_source = base_dir / "models" / "form_detector.onnx"
    model_dest = (
        base_dir.parent / "extension" / "public" / "models" / "form_detector.onnx"
    )

    if model_source.exists():
        shutil.copy(model_source, model_dest)
        print(f"Model copied to {model_dest}")
    else:
        print(f"Error: Model not found at {model_source}")
        sys.exit(1)

    print("\n=== Pipeline Complete ===")
    print(f"Model size: {model_dest.stat().st_size / 1024:.2f} KB")


if __name__ == "__main__":
    main()
