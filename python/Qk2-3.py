from qiskit import *
from qiskit_aer import *
import matplotlib.pyplot as plt
q = QuantumRegister(1 , 'q0')  # 1つの量子レジスタqの生成
c = ClassicalRegister(1 , 'c0')  # 1つの古典レジスタcの生成
qc = QuantumCircuit(q , c)  # 量子回路qcの生成
qc.x(q[0])  # 量子ビットq[0]のビット反転演算
qc.x(q[0])  # 量子ビットq[0]のビット反転演算
qc.measure(q, c)  # 量子レジスタqを測定して古典レジスタcに入れる
# 量子回路を実行し、結果rに代入する
be = Aer.get_backend('aer_simulator')
r = be.run(qc ,shots=100).result()
# 量子回路名qcの量子プログラムの実行結果rからカウント結果取得し表示する
print(r.get_counts())
# 量子回路図の表示
fig = qc.draw('mpl')
fig.savefig('circuit2-3.png')

