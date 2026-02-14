"""XGBoost training pipeline with ONNX export."""

import json
import numpy as np
import xgboost as xgb
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score
from onnxmltools.convert.common.data_types import FloatTensorType
from onnxmltools.convert import convert_xgboost
import onnx
import onnxruntime as ort
from features import FieldFeatures


LABEL_MAPPING = {
    "username": 0,
    "password": 1,
    "email": 2,
    "totp": 3,
    "none": 4,
}

REVERSE_MAPPING = {v: k for k, v in LABEL_MAPPING.items()}


def load_dataset(path: str):
    with open(path, "r") as f:
        data = json.load(f)

    X = []
    y = []

    for item in data:
        features = np.array(item["features"], dtype=np.float32)
        label = LABEL_MAPPING.get(item["label"], 4)
        X.append(features)
        y.append(label)

    return np.array(X), np.array(y)


def train_model(X_train, y_train, X_val, y_val):
    model = xgb.XGBClassifier(
        n_estimators=150,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="multi:softprob",
        num_class=5,
        eval_metric="mlogloss",
        early_stopping_rounds=20,
        random_state=42,
    )

    model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

    return model


def evaluate_model(model, X_test, y_test):
    predictions = model.predict(X_test)
    accuracy = accuracy_score(y_test, predictions)

    print(f"Test Accuracy: {accuracy:.4f}")
    print("\nClassification Report:")
    print(
        classification_report(
            y_test,
            predictions,
            target_names=["username", "password", "email", "totp", "none"],
        )
    )

    return accuracy


def export_to_onnx(model, output_path: str):
    initial_type = [("float_input", FloatTensorType([None, 45]))]

    onnx_model = convert_xgboost(model, initial_types=initial_type)

    onnx.save(onnx_model, output_path)

    size_kb = len(onnx_model.SerializeToString()) / 1024
    print(f"Model exported to {output_path}")
    print(f"Model size: {size_kb:.2f} KB")

    return onnx_model


def verify_onnx_model(onnx_path: str, X_sample: np.ndarray):
    session = ort.InferenceSession(onnx_path)

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: X_sample[:5]})

    print("ONNX model verification successful")
    print(f"Input shape: {X_sample[:5].shape}")
    print(f"Output shape: {outputs[0].shape}")

    return outputs


def main():
    print("Loading dataset...")
    X, y = load_dataset("data/processed/training_data.json")
    print(f"Loaded {len(X)} samples with {X.shape[1]} features")

    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.3, random_state=42, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.5, random_state=42, stratify=y_temp
    )

    print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

    print("\nTraining XGBoost model...")
    model = train_model(X_train, y_train, X_val, y_val)

    print("\nEvaluating model...")
    evaluate_model(model, X_test, y_test)

    print("\nExporting to ONNX...")
    export_to_onnx(model, "models/form_detector.onnx")

    print("\nVerifying ONNX model...")
    verify_onnx_model("models/form_detector.onnx", X_test)

    print("\nTraining complete!")


if __name__ == "__main__":
    main()
