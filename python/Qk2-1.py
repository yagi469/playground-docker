from qiskit import *
from qiskit_aer import *
q = QuantumRegister(1)  # 1つの量子レジスタqの生成
c = ClassicalRegister(1)  # 1つの古典レジスタcの生成
qc = QuantumCircuit(q, c)  # 量子回路qcの生成
qc.measure(q, c)  # 量子レジスタqを測定して古典レジスタcに入れる
be = Aer.get_backend('aer_simulator')
res = be.run(qc ,shots=100).result()  # 量子回路を実行し、結果rに代入する
# 量子回路qcの量子プログラムの実行結果resからカウント結果を取得し表示する
print(res.get_counts(qc))